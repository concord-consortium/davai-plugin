// Turn orchestration for the AgentCore container.
//
// This is the essence of the old reference/sam-server/src/handlers/job-processor.ts
// (lines ~91-233) with the SQS/RDS plumbing removed: no jobs table, no queue, no
// pg LISTEN. State lives in the in-VM MemorySaver keyed by thread_id. The turn
// loop, tool-repair self-heal, streaming accumulation, and response shape are
// preserved verbatim so the client sees identical outputs.

import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getLangApp } from "./agent/utils/llm-utils.js";
import {
  buildToolRepairMessages,
  extractToolCalls,
  toolCallResponse,
} from "./agent/utils/tool-utils.js";
import {
  messageTextToString,
  shouldFlush,
  isAbortError,
  withAccumulatedResponse,
} from "./agent/utils/stream-utils.js";
import type { TurnInput } from "./types.js";

// Same as the old buildResponse: a tool call becomes a requires_action payload;
// otherwise coerce content to a string (Anthropic can return content-block arrays).
const buildResponse = async (message: any) => {
  const toolCalls = extractToolCalls(message);
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls[0]);
  }
  return { response: messageTextToString(message.content) };
};

export interface RunTurnOpts {
  signal?: AbortSignal;
  // Called with the accumulated user-facing text as it streams (for SSE / WebSocket).
  onToken?: (accumulatedText: string) => void;
}

/**
 * Run one conversational turn (a user message or a tool result) and return the
 * output the client already understands: `{ response }` or a requires_action
 * tool-call payload, with any pre-tool text attached via withAccumulatedResponse.
 */
export async function runTurn(input: TurnInput, opts: RunTurnOpts = {}): Promise<any> {
  // Transport-testing shortcut (off by default). See fake-agent.ts.
  if (process.env.DAVAI_FAKE_AGENT === "1") {
    const { fakeTurn } = await import("./fake-agent.js");
    return fakeTurn(input, opts);
  }

  const onToken = opts.onToken;
  // Always pass a concrete AbortSignal — LangGraph/checkpointer paths read
  // config.signal.aborted, so an undefined signal throws.
  const signal = opts.signal ?? new AbortController().signal;

  const config: any = {
    configurable: {
      llmId: input.llmId,
      thread_id: input.threadId,
      effort: (input as any).effort,
    },
    signal,
  };

  const app = await getLangApp();

  // Self-heal: inject synthetic error tool_results for any orphaned tool_use at the
  // tail of the thread so this call doesn't 400 on a dangling tool_use.
  let priorMessages: any[] = [];
  try {
    const priorState = await app.getState(config);
    priorMessages = priorState?.values?.messages ?? [];
  } catch (stateError) {
    console.warn("Could not load thread state; skipping tool-call repair:", stateError);
  }

  const answeringToolCallId = input.kind === "tool" ? input.message.tool_call_id : undefined;
  const messages: any[] = [...buildToolRepairMessages(priorMessages, answeringToolCallId)];
  let dataContexts: any = {};
  let graphs: any = [];

  if (input.kind === "tool") {
    let toolMessageContent: string;
    let humanMessage: HumanMessage | undefined;
    if (Array.isArray(input.message.content)) {
      toolMessageContent = "ok";
      humanMessage = new HumanMessage({ content: input.message.content });
    } else {
      toolMessageContent = input.message.content;
    }
    messages.push(
      new ToolMessage({
        content: toolMessageContent,
        tool_call_id: input.message.tool_call_id,
      })
    );
    if (humanMessage) messages.push(humanMessage);
  } else {
    dataContexts = input.dataContexts || {};
    graphs = input.graphs || [];
    messages.push(new HumanMessage({ content: input.message }));
  }

  // Stream: "messages" surfaces token chunks (text only); "values" yields the final
  // graph state, whose last message preserves tool_calls/content-block structure.
  let accumulated = "";
  let lastEmitted = 0;
  let finalMessage: any;

  try {
    const stream = (await app.stream(
      { messages, dataContexts, graphs },
      { ...config, streamMode: ["messages", "values"] }
    )) as AsyncIterable<[string, any]>;
    for await (const [mode, payload] of stream) {
      if (signal.aborted) break;
      if (mode === "messages") {
        const chunkText = messageTextToString((payload as any)[0]?.content);
        if (chunkText) {
          accumulated += chunkText;
          if (onToken && shouldFlush(accumulated, lastEmitted)) {
            onToken(messageTextToString(accumulated));
            lastEmitted = accumulated.length;
          }
        }
      } else if (mode === "values") {
        const msgs = (payload as any)?.messages;
        if (Array.isArray(msgs) && msgs.length) finalMessage = msgs[msgs.length - 1];
      }
    }
  } catch (streamError) {
    if (isAbortError(streamError, signal)) {
      return { status: "cancelled" };
    }
    throw streamError;
  }

  // Flush trailing text (a mixed text+tool turn's terminal payload carries no text).
  if (onToken && accumulated.length > lastEmitted) {
    onToken(messageTextToString(accumulated));
  }

  if (signal.aborted) {
    return { status: "cancelled" };
  }

  const built = finalMessage
    ? await buildResponse(finalMessage)
    : { response: messageTextToString(accumulated) };
  return withAccumulatedResponse(built, messageTextToString(accumulated));
}
