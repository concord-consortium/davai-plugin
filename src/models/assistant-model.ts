import { types, flow, Instance } from "mobx-state-tree";
import { Message } from "openai/resources/beta/threads/messages";
import { getAttributeList, getDataContext } from "@concord-consortium/codap-plugin-api";
import { getTools, initLlmConnection } from "../utils/llm-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { DAVAI_SPEAKER } from "../constants";
import { createGraph } from "../utils/codap-utils";

/**
 * AssistantModel encapsulates the AI assistant and its interactions with the user.
 * It includes properties and methods for configuring the assistant, handling chat interactions, and maintaining the assistant's
 * thread and transcript.
 *
 * @property {Object|null} assistant - The assistant object, or `null` if not initialized.
 * @property {string} assistantId - The unique ID of the assistant being used.
 * @property {string} instructions - Instructions provided when creating or configuring a new assistant.
 * @property {string} modelName - The identifier for the assistant's model (e.g., "gpt-4o-mini").
 * @property {Object|null} apiConnection - The API connection object for interacting with the assistant, or `null` if not connected.
 * @property {Object|null} thread - The assistant's thread used for the current chat, or `null` if no thread is active.
 * @property {ChatTranscriptModel} transcriptStore - The assistant's chat transcript store for recording and managing chat messages.
 * @property {boolean} useExisting - A flag indicating whether to use an existing assistant (`true`) or create a new one (`false`).
 */
export const AssistantModel = types
  .model("AssistantModel", {
    assistant: types.maybe(types.frozen()),
    assistantId: types.string,
    instructions: types.string,
    modelName: types.string,
    apiConnection: types.maybe(types.frozen()),
    thread: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel,
    useExisting: true,
  })
  .actions((self) => ({
    handleMessageSubmitMockAssistant() {
      // Use a brief delay to prevent duplicate timestamp-based keys.
      setTimeout(() => {
        self.transcriptStore.addMessage(
          DAVAI_SPEAKER,
          "I'm just a mock assistant and can't process that request."
        );
      }, 1000);
    }
  }))
  .actions((self) => ({
    afterCreate(){
      self.apiConnection = initLlmConnection();
    }
  }))
  .actions((self) => {
    const initialize = flow(function* () {
      try {
        const tools = getTools();

        const davaiAssistant = self.useExisting && self.assistantId
          ? yield self.apiConnection.beta.assistants.retrieve(self.assistantId)
          : yield self.apiConnection.beta.assistants.create({instructions: self.instructions, model: self.modelName, tools });

        if (!self.useExisting) {
          self.assistantId = davaiAssistant.id;
        }
        self.assistant = davaiAssistant;
        self.thread = yield self.apiConnection.beta.threads.create();
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
      }
    });

    const handleMessageSubmit = flow(function* (messageText) {
      try {
        yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: messageText,
        });
        yield startRun();

      } catch (err) {
        console.error("Failed to handle message submit:", err);
      }
    });

    const startRun = flow(function* () {
      try {
        const run = yield self.apiConnection.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });

        // Wait for run completion and handle responses
        let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, run.id);
        while (runState.status !== "completed" && runState.status !== "requires_action") {
          runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, run.id);
        }

        if (runState.status === "requires_action") {
          yield handleRequiredAction(runState, run.id);
        }

        // Get the last assistant message from the messages array
        const messages = yield self.apiConnection.beta.threads.messages.list(self.thread.id);
        const lastMessageForRun = messages.data.filter(
          (msg: Message) => msg.run_id === run.id && msg.role === "assistant"
        ).pop();

        self.transcriptStore.addMessage(
          DAVAI_SPEAKER,
          lastMessageForRun?.content[0]?.text?.value || "Error processing request."
        );
      } catch (err) {
        console.error("Failed to complete run:", err);
      }
    });

    const handleRequiredAction = flow(function* (runState, runId) {
      try {
        const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
          ? yield Promise.all(
            runState.required_action.submit_tool_outputs.tool_calls.map(flow(function* (toolCall: any) {
              if (toolCall.function.name === "get_attributes") {
                const { dataset } = JSON.parse(toolCall.function.arguments);
                // getting the root collection won't always work. what if a user wants the attributes
                // in the Mammals dataset but there is a hierarchy?
                const rootCollection = (yield getDataContext(dataset)).values.collections[0];
                const attributeList = yield getAttributeList(dataset, rootCollection.name);
                return { tool_call_id: toolCall.id, output: JSON.stringify(attributeList) };
              } else {
                const { dataset, name, xAttribute, yAttribute } = JSON.parse(toolCall.function.arguments);
                createGraph(dataset, name, xAttribute, yAttribute);
                return { tool_call_id: toolCall.id, output: "Graph created." };
              }
            })
          ))
          : [];

        if (toolOutputs) {
          yield self.apiConnection.beta.threads.runs.submitToolOutputs(
            self.thread.id, runId, { tool_outputs: toolOutputs }
          );

        }
      } catch (err) {
        console.error(err);
      }
    });

    const createThread = flow(function* () {
      try {
        const newThread = yield self.apiConnection.beta.threads.create();
        self.thread = newThread;
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    });

    const deleteThread = flow(function* () {
      try {
        if (!self.thread) {
          console.warn("No thread to delete.");
          return;
        }

        const threadId = self.thread.id;
        const response = yield fetch(`${process.env.REACT_APP_OPENAI_BASE_URL}threads/${threadId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
            "Content-Type": "application/json",
          },
        });
    
        if (response.ok) {
          self.thread = undefined;
        } else {
          console.warn("Failed to delete thread, unexpected response:", response.status);
        }
      } catch (err) {
        console.error("Error deleting thread:", err);
      }
    });

    return { createThread, deleteThread, initialize, handleMessageSubmit };
  });

export interface AssistantModelType extends Instance<typeof AssistantModel> {}
