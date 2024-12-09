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
        const run = yield davai.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });

        // Wait for run completion and handle responses
        let runState = yield davai.beta.threads.runs.retrieve(self.thread.id, run.id);
        while (runState.status !== "completed" && runState.status !== "requires_action") {
          runState = yield davai.beta.threads.runs.retrieve(self.thread.id, run.id);
        }

        if (runState.status === "requires_action") {
          transcriptStore.addMessage(DEBUG_SPEAKER, {description: "User request requires action", content: formatMessage(runState)});
          yield handleRequiredAction(runState, run.id);
        }

        // Get the last assistant message from the messages array
        const messages = yield davai.beta.threads.messages.list(self.thread.id);
        transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Updated thread messages list", content: formatMessage(messages)});

        const lastMessageForRun = messages.data.filter(
          (msg: Message) => msg.run_id === run.id && msg.role === "assistant"
        ).pop();

        const lastMessageContent = lastMessageForRun?.content[0]?.text?.value;
        if (lastMessageContent) {
          transcriptStore.addMessage(DAVAI_SPEAKER, {content: lastMessageContent});
        } else {
          transcriptStore.addMessage(DAVAI_SPEAKER, {content: "I'm sorry, I don't have a response for that."});
          transcriptStore.addMessage(DEBUG_SPEAKER, {description: "No content in last message", content: formatMessage(lastMessageForRun)});
        }

      } catch (err) {
        console.error("Failed to complete run:", err);
        transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to complete run", content: formatMessage(err)});
      }
    });

    const handleRequiredAction = flow(function* (runState, runId) {
      try {
        const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
          ? yield Promise.all(
            runState.required_action.submit_tool_outputs.tool_calls.map(async (toolCall: any) => {
              if (toolCall.function.name === "get_attributes") {
                const { dataset } = JSON.parse(toolCall.function.arguments);
                // getting the root collection won't always work. what if a user wants the attributes
                // in the Mammals dataset but there is a hierarchy?
                const rootCollection = (await getDataContext(dataset)).values.collections[0];
                const attributeListRes = await getAttributeList(dataset, rootCollection.name);
                const { requestMessage, ...codapResponse } = attributeListRes;
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatMessage(requestMessage) });
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatMessage(codapResponse) });
                return { tool_call_id: toolCall.id, output: JSON.stringify(attributeListRes) };
              } else {
                const { dataset, name, xAttribute, yAttribute } = JSON.parse(toolCall.function.arguments);
                const { requestMessage, ...codapResponse} = await createGraph(dataset, name, xAttribute, yAttribute);
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatMessage(requestMessage) });
                transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatMessage(codapResponse) });
                return { tool_call_id: toolCall.id, output: "Graph created." };
              }
            })
          )
          : [];

        if (toolOutputs) {
          davai.beta.threads.runs.submitToolOutputsStream(
            self.thread.id, runId, { tool_outputs: toolOutputs }
          );

          const threadMessageList = yield davai.beta.threads.messages.list(self.thread.id);
          const threadMessages = threadMessageList.data.map((msg: any) => ({
            role: msg.role,
            content: msg.content[0].text.value,
          }));

          yield davai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              ...threadMessages
            ],
          });
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
