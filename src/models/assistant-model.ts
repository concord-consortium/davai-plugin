import { types, flow } from "mobx-state-tree";
import { getTools, initLlmConnection } from "../utils/llm-utils";
import { ChatTranscriptModel, transcriptStore } from "./chat-transcript-model";
import { Message } from "openai/resources/beta/threads/messages";
import { getAttributeList, getDataContext, getListOfDataContexts } from "../utils/codap-api-helpers";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { createGraph } from "../utils/codap-utils";
import { formatMessage } from "../utils/utils";
import appConfigJson from "../app-config.json";

export const AssistantModel = types
  .model("AssistantModel", {
    assistant: types.maybe(types.frozen()),
    assistantId: types.string,
    instructions: types.string,
    model: types.string,
    thread: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel,
    useExistingAssistant: true
  })
  .actions((self) => {
    const davai = initLlmConnection();

    const initialize = flow(function* () {
      try {
        const tools = getTools();

        const davaiAssistant = self.useExistingAssistant && self.assistantId
          ? yield davai.beta.assistants.retrieve(self.assistantId)
          : yield davai.beta.assistants.create({instructions: self.instructions, model: self.model, tools });

        if (!self.useExistingAssistant) {
          self.assistantId = davaiAssistant.id;
        }
        self.assistant = davaiAssistant;
        self.thread = yield davai.beta.threads.create();
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "You are chatting with assistant",
          content: formatMessage(self.assistant)
        });
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "New thread created",
          content: formatMessage(self.thread)
        });
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Failed to initialize assistant",
          content: formatMessage(err)
        });
      }
    });

    const handleMessageSubmit = flow(function* (messageText) {
      try {
        const messageSent = yield davai.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: messageText,
        });

        transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Message sent to LLM", content: formatMessage(messageSent)});
        yield startRun();

      } catch (err) {
        console.error("Failed to handle message submit:", err);
        transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to handle message submit", content: formatMessage(err)});
      }
    });

    const startRun = flow(function* () {
      try {
        const currentRun = yield davai.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run created",
          content: formatMessage(currentRun),
        });

        yield pollRunState(currentRun.id);
      } catch (err) {
        console.error("Failed to complete run:", err);
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Failed to complete run",
          content: formatMessage(err),
        });
      }
    });

    const pollRunState: (currentRunId: string) => Promise<any> = flow(function* (currentRunId) {
       let runState = yield davai.beta.threads.runs.retrieve(self.thread.id, currentRunId);
       transcriptStore.addMessage(DEBUG_SPEAKER, {
         description: "Polling run state",
         content: formatMessage(runState),
       });

      while (runState.status !== "completed" && runState.status !== "requires_action") {
        yield new Promise((resolve) => setTimeout(resolve, 2000));
        runState = yield davai.beta.threads.runs.retrieve(self.thread.id, currentRunId);
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Polling run state",
          content: formatMessage(runState),
        });
      }

      if (runState.status === "requires_action") {
        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run requires action",
          content: formatMessage(runState),
        });
        yield handleRequiredAction(runState, currentRunId);
        yield pollRunState(currentRunId);
      }

      if (runState.status === "completed") {
        const messages = yield davai.beta.threads.messages.list(self.thread.id);

        const lastMessageForRun = messages.data
          .filter((msg: Message) => msg.run_id === currentRunId && msg.role === "assistant")
          .pop();

        transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run completed, assistant response",
          content: formatMessage(lastMessageForRun),
        });

        const lastMessageContent = lastMessageForRun?.content[0]?.text?.value;
        if (lastMessageContent) {
          transcriptStore.addMessage(DAVAI_SPEAKER, { content: lastMessageContent });
        } else {
          transcriptStore.addMessage(DAVAI_SPEAKER, {
            content: "I'm sorry, I don't have a response for that.",
          });
        }
      }
    });

    const handleRequiredAction = flow(function* (runState, runId) {
      try {
        const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
          ? yield Promise.all(
            runState.required_action.submit_tool_outputs.tool_calls.map(async (toolCall: any) => {
              if (toolCall.function.name === "get_data_contexts") {
                const dataContextList = await getListOfDataContexts();
                const { requestMessage, ...codapResponse } = dataContextList;
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatMessage(requestMessage) });
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatMessage(codapResponse) });
                return { tool_call_id: toolCall.id, output: JSON.stringify(dataContextList) };
              } else if (toolCall.function.name === "get_attributes") {
                const { dataset } = JSON.parse(toolCall.function.arguments);
                // getting the root collection won't always work. what if a user wants the attributes
                // in the Mammals dataset but there is a hierarchy?
                const rootCollection = (await getDataContext(dataset)).values.collections[0];
                const attributeListRes = await getAttributeList(dataset, rootCollection.name);
                const { requestMessage, ...codapResponse } = attributeListRes;
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatMessage(requestMessage) });
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatMessage(codapResponse) });
                return { tool_call_id: toolCall.id, output: JSON.stringify(attributeListRes) };
              } else if (toolCall.function.name === "create_graph") {
                const { dataset, name, xAttribute, yAttribute } = JSON.parse(toolCall.function.arguments);
                const { requestMessage, ...codapResponse} = await createGraph(dataset, name, xAttribute, yAttribute);
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatMessage(requestMessage) });
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatMessage(codapResponse) });
                return { tool_call_id: toolCall.id, output: "Graph created." };
              } else {
                return { tool_call_id: toolCall.id, output: "Tool call not recognized." };
              }
            })
          )
          : [];

        if (toolOutputs) {
          yield davai.beta.threads.runs.submitToolOutputs(
            self.thread.id, runId, { tool_outputs: toolOutputs }
          );
        }
      } catch (err) {
        console.error(err);
        transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Error taking required action", content: formatMessage(err)});
      }
    });

    return { initialize, handleMessageSubmit };
  });

const assistant = appConfigJson.config.assistant;
export const assistantStore = AssistantModel.create({
  assistantId: assistant.existing_assistant_id,
  model: assistant.model,
  instructions: assistant.instructions,
  transcriptStore,
  useExistingAssistant: assistant.use_existing
});
