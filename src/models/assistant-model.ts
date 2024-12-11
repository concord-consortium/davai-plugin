import { types, flow, Instance } from "mobx-state-tree";
import { Message } from "openai/resources/beta/threads/messages";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { formatMessage } from "../utils/utils";
import { getTools, initLlmConnection } from "../utils/llm-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { requestThreadDeletion } from "../utils/openai-utils";

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
          { content: "I'm just a mock assistant and can't process that request." }
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
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "You are chatting with assistant",
          content: formatMessage(self.assistant)
        });
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "New thread created",
          content: formatMessage(self.thread)
        });
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Failed to initialize assistant",
          content: formatMessage(err)
        });
      }
    });

    const handleMessageSubmit = flow(function* (messageText) {
      try {
        const messageSent = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: messageText,
        });

        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Message sent to LLM", content: formatMessage(messageSent)});
        yield startRun();

      } catch (err) {
        console.error("Failed to handle message submit:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to handle message submit", content: formatMessage(err)});
      }
    });

    const startRun = flow(function* () {
      try {
        const run = yield self.apiConnection.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });

        yield pollRunState(run.id);
      } catch (err) {
        console.error("Failed to complete run:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Failed to complete run",
          content: formatMessage(err),
        });
      }
    });

    const pollRunState: (currentRunId: string) => Promise<any> = flow(function* (currentRunId) {
      let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, currentRunId);
      self.transcriptStore.addMessage(DEBUG_SPEAKER, {
        description: "Run state status",
        content: formatMessage(runState.status),
      });

     const errorStates = ["failed", "cancelled", "incomplete"];

     while (runState.status !== "completed" && runState.status !== "requires_action" && !errorStates.includes(runState.status)) {
       yield new Promise((resolve) => setTimeout(resolve, 2000));
       runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, currentRunId);
       self.transcriptStore.addMessage(DEBUG_SPEAKER, {
         description: "Run state status",
         content: formatMessage(runState.status),
       });
     }

     if (errorStates.includes(runState.status)) {
      self.transcriptStore.addMessage(DEBUG_SPEAKER, {
         description: "Run failed",
         content: formatMessage(runState),
       });
       self.transcriptStore.addMessage(DAVAI_SPEAKER, {
         content: "I'm sorry, I encountered an error. Please try again.",
       });
     }

     if (runState.status === "requires_action") {
      self.transcriptStore.addMessage(DEBUG_SPEAKER, {
         description: "Run requires action",
         content: formatMessage(runState),
       });
       yield handleRequiredAction(runState, currentRunId);
       yield pollRunState(currentRunId);
     }

     if (runState.status === "completed") {
       const messages = yield self.apiConnection.beta.threads.messages.list(self.thread.id);

       const lastMessageForRun = messages.data
         .filter((msg: Message) => msg.run_id === currentRunId && msg.role === "assistant")
         .pop();

         self.transcriptStore.addMessage(DEBUG_SPEAKER, {
         description: "Run completed, assistant response",
         content: formatMessage(lastMessageForRun),
       });

       const lastMessageContent = lastMessageForRun?.content[0]?.text?.value;
       if (lastMessageContent) {
        self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: lastMessageContent });
       } else {
        self.transcriptStore.addMessage(DAVAI_SPEAKER, {
           content: "I'm sorry, I don't have a response for that.",
         });
       }
     }
   });

    const handleRequiredAction = flow(function* (runState, runId) {
      try {
        const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
          ? yield Promise.all(
            runState.required_action.submit_tool_outputs.tool_calls.map(flow(function* (toolCall: any) {
              if (toolCall.function.name === "create_request") {
                const { action, resource, values } = JSON.parse(toolCall.function.arguments);
                const request = { action, resource, values };
                self.transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatMessage(request) });
                const res = yield codapInterface.sendRequest(request);
                self.transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatMessage(res) });
                return { tool_call_id: toolCall.id, output: JSON.stringify(res) };
              } else {
                return { tool_call_id: toolCall.id, output: "Tool call not recognized." };
              }
            })
          ))
          : [];

        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Tool outputs", content: formatMessage(toolOutputs)});
        if (toolOutputs) {
          yield self.apiConnection.beta.threads.runs.submitToolOutputs(
            self.thread.id, runId, { tool_outputs: toolOutputs }
          );
        }
      } catch (err) {
        console.error(err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Error taking required action", content: formatMessage(err)});
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
        const response = yield requestThreadDeletion(threadId);

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
