import { types, flow, Instance, onSnapshot } from "mobx-state-tree";
import { OpenAI } from "openai";
import { Message } from "openai/resources/beta/threads/messages";
import { codapInterface, getDataContext, getListOfDataContexts } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { convertBase64ToImage, formatJsonMessage } from "../utils/utils";
import { ChatTranscriptModel } from "./chat-transcript-model";

const OpenAIType = types.custom({
  name: "OpenAIType",
  fromSnapshot(snapshot: OpenAI) {
    return new OpenAI({
      apiKey: snapshot.apiKey,
      dangerouslyAllowBrowser: true,
    });
  },
  toSnapshot() {
    return undefined; // OpenAI instance is non-serializable
  },
  isTargetType(value) {
    return value instanceof OpenAI;
  },
  getValidationMessage() {
    return "";
  },
});

/**
 * AssistantModel encapsulates the AI assistant and its interactions with the user.
 * It includes properties and methods for configuring the assistant, handling chat interactions, and maintaining the assistant's
 * thread and transcript.
 *
 * @property {Object|null} assistant - The assistant object, or `null` if not initialized.
 * @property {string} assistantId - The unique ID of the assistant being used, or `null` if not initialized.
 * @property {Object} apiConnection - The API connection object for interacting with the assistant
 * @property {Object|null} thread - The assistant's thread used for the current chat, or `null` if no thread is active.
 * @property {string|null} run - The current/last run, or `undefined` if no run is active.
 * @property {ChatTranscriptModel} transcriptStore - The assistant's chat transcript store for recording and managing chat messages.
 * @property {boolean} isLoadingResponse - Flag indicating whether the assistant is currently processing a response.
 * @property {string[]} codapNotificationQueue - Queue of notifications to be sent to the assistant. Used if CODAP generates notifications while assistant is processing a response.
 * @property {boolean} uploadFileAfterRun - Flag indicating whether to upload a file after the assistant completes a run.
 * @property {string} dataUri - The data URI of the file to be uploaded.
 */
export const AssistantModel = types
  .model("AssistantModel", {
    apiConnection: OpenAIType,
    assistant: types.maybe(types.frozen()),
    assistantId: types.string,
    cancellingRunId: types.maybe(types.string),
    isLoadingResponse: types.optional(types.boolean, false),
    thread: types.maybe(types.frozen()),
    run: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel,
    codapNotificationQueue: types.array(types.string),
    uploadFileAfterRun: false,
    dataUri: "",
  })
  .actions((self) => ({
    setIsLoadingResponse(isLoading: boolean) {
      self.isLoadingResponse = isLoading;
    }
  }))
  .actions((self) => ({
    handleMessageSubmitMockAssistant() {
      self.setIsLoadingResponse(true);
      // Use a brief delay to prevent duplicate timestamp-based keys.
      setTimeout(() => {
        self.transcriptStore.addMessage(
          DAVAI_SPEAKER,
          { content: "I'm just a mock assistant and can't process that request." }
        );
        self.setIsLoadingResponse(false);
      }, 2000);
    },
    setTranscriptStore(transcriptStore: any) {
      self.transcriptStore = transcriptStore;
    }
  }))
  .actions((self) => {
    const initializeAssistant = flow(function* () {
      if (self.assistantId === "mock") return;

      try {
        if (!self.apiConnection) throw new Error("API connection is not initialized");
        self.assistant  = yield self.apiConnection.beta.assistants.retrieve(self.assistantId);
        self.thread = yield self.apiConnection.beta.threads.create();
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "You are chatting with assistant",
          content: formatJsonMessage(self.assistant)
        });
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "New thread created",
          content: formatJsonMessage(self.thread)
        });
        fetchAndSendDataContexts();
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Failed to initialize assistant",
          content: formatJsonMessage(err)
        });
      }
    });

    const fetchAndSendDataContexts = flow(function* () {
      try {
        const contexts = yield getListOfDataContexts();
        const contextsDetails: Record<string, any> = {};
        for (const ctx of contexts.values) {
          const { name } = ctx;
          const ctxDetails = yield getDataContext(name);
          contextsDetails[name] = ctxDetails.values;
        }
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Data contexts information", content: formatJsonMessage(contextsDetails)});
        sendCODAPDocumentInfo(`Data contexts: ${JSON.stringify(contextsDetails)}`);
      } catch (err) {
        console.error("Failed to get data contexts:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to get data contexts", content: formatJsonMessage(err)});
      }
    });

    const sendDataCtxChangeInfo = flow(function* (msg: string) {
      try {
        if (self.isLoadingResponse) {
          self.codapNotificationQueue.push(msg);
        } else {
          yield sendCODAPDocumentInfo(msg);
        }
      } catch (err) {
        console.error("Failed to send data context info to LLM:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to send data context info to d LLM", content: formatJsonMessage(err)});
      }
    });

    const sendCODAPDocumentInfo = flow(function* (message) {
      try {
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Sending CODAP document information to LLM", content: message});
        const messageSent = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: `This is a system message containing information about the CODAP document. ${message}`,
        });
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "CODAP document information received by LLM", content: formatJsonMessage(messageSent)});
      }
      catch (err) {
        console.error("Failed to send system message:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to send CODAP document information to LLM", content: formatJsonMessage(err)});
      }
    });

    const handleMessageSubmit = flow(function* (messageText) {
      try {
        const messageSent = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: messageText,
        });
        self.setIsLoadingResponse(true);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Message received by LLM", content: formatJsonMessage(messageSent)});
        yield startRun();

      } catch (err) {
        console.error("Failed to handle message submit:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to handle message submit", content: formatJsonMessage(err)});
        self.setIsLoadingResponse(false);
      }
    });

    const startRun = flow(function* () {
      try {
        const run = yield self.apiConnection.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });
        self.run = run;
        yield pollRunState();
      } catch (err) {
        console.error("Failed to complete run:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Failed to complete run",
          content: formatJsonMessage(err),
        });
      }
    });

    const cancelRun = flow(function* () {
      try {
        self.setIsLoadingResponse(false);

        if (!self.run) {
          // wait until run is defined to go through with cancellation
          yield new Promise((resolve) => setTimeout(resolve, 2000));
        }

        const cancelRunId = self.run.id;
        let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, cancelRunId);

        if (["cancelled", "completed", "failed"].includes(runState.status)) {
          self.run = undefined;
          return;
        }

        if (runState.status === "cancelling") {
          self.run = undefined;
          backgroundPollCancel(cancelRunId);
        } else {
          const cancelResponse = yield self.apiConnection.beta.threads.runs.cancel(self.thread.id, cancelRunId);
          self.transcriptStore.addMessage(DEBUG_SPEAKER, {
            description: "User cancelled run",
            content: formatJsonMessage(cancelResponse),
          });
          self.run = undefined;
          backgroundPollCancel(cancelResponse.id);
        }
      } catch (err: any) {
        // If the error message is "Cannot cancel run with status 'cancelled'",
        // treat it as a no-op success instead of a real failure
        if (err.message === "Cannot cancel run with status 'cancelled'.") {
          console.log("Run was already canceled on server; ignoring 400 error.");
          // Do the same local cleanup
          self.run = undefined;
          self.isLoadingResponse = false;
        } else {
          console.error("Failed to cancel the run:", err);
          self.transcriptStore.addMessage(DEBUG_SPEAKER, {
            description: "Failed to cancel run",
            content: formatJsonMessage(err),
          });
        }
      }
    });

    const backgroundPollCancel = flow(function* (runId: string) {
      try {
        const startTime = Date.now();
        let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
        const MAX_WAIT_TIME = 30_000; // 30 seconds

        while (runState.status === "cancelling") {
          const elapsed = Date.now() - startTime;
          if (elapsed >= MAX_WAIT_TIME) {
            self.transcriptStore.addMessage(DEBUG_SPEAKER, {
              description: "Run stuck in 'cancelling'",
              content: formatJsonMessage(runState),
            });
            yield clearThreadAndPreserveHistory();
            self.transcriptStore.addMessage(DAVAI_SPEAKER, {
              content: "I'm having trouble cancelling your request. Please wait while I begin a new conversation while preserving our chat history...",
            });
            break;
          }
          yield new Promise(resolve => setTimeout(resolve, 2000));
          runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
        }

        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: `Background polling for run ${runId} ended`,
          content: `Final status: ${runState.status}`
        });
      }
      catch (err) {
        // If there's an API error, just log it
        console.error("Background poll cancel error:", err);
      }
    });

    const clearThreadAndPreserveHistory = flow(function* () {
      try {
        const chatHistory = self.transcriptStore.messages;
        yield deleteThread();
        yield createThread();
        const messageSent = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: `This is a system message. A previous thread was deleted because it took to long to cancel a run.
          Here is the preserved chat history: ${chatHistory}`,
        });
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Thread cleared and history preserved", content: formatJsonMessage(messageSent)});
      }
      catch (err) {
        console.error("Failed to clear thread and preserve history:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to clear thread and preserve history", content: formatJsonMessage(err)});
      }
    });

    const pollRunState: () => Promise<any> = flow(function* () {
      if (!self.run) return; // just in case we canceled already

      const runId = self.run.id;
      let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);

      self.transcriptStore.addMessage(DEBUG_SPEAKER, {
        description: "Run state status",
        content: formatJsonMessage(runState.status),
      });

      const stopPollingStates = ["completed", "requires_action", "cancelled", "cancelling"];
      const errorStates = ["failed", "incomplete"];

      while (!stopPollingStates.includes(runState.status) && !errorStates.includes(runState.status)) {
        yield new Promise((resolve) => setTimeout(resolve, 2000));
        runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);

        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run state status (from pollRunState)",
          content: formatJsonMessage(runState.status),
        });
      }

      if (runState.status === "cancelled") {
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run cancelled (from pollRunState)",
          content: formatJsonMessage(runState),
        });
        self.setIsLoadingResponse(false);
      }

      if (runState.status === "requires_action") {
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run requires action",
          content: formatJsonMessage(runState),
        });
        yield handleRequiredAction(runState);
        yield pollRunState();
      }

      if (runState.status === "completed") {
        if (self.uploadFileAfterRun && self.dataUri) {
          const fileId = yield uploadFile();
          yield sendFileMessage(fileId);
          self.uploadFileAfterRun = false;
          self.dataUri = "";
          startRun();
        } else {
          const messages = yield self.apiConnection.beta.threads.messages.list(self.thread.id);

          const lastMessageForRun = messages.data
            .filter((msg: Message) => msg.run_id === runId && msg.role === "assistant")
            .pop();

          self.transcriptStore.addMessage(DEBUG_SPEAKER, {
            description: "Run completed, assistant response",
            content: formatJsonMessage(lastMessageForRun),
          });

          const lastMessageContent = lastMessageForRun?.content[0]?.text?.value;
          if (lastMessageContent) {
            self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: lastMessageContent });
          } else {
            self.transcriptStore.addMessage(DAVAI_SPEAKER, {
              content: "I'm sorry, I don't have a response for that.",
            });
          }
          self.run = undefined;
          self.setIsLoadingResponse(false);
        }
      }

      if (errorStates.includes(runState.status)) {
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run failed",
          content: formatJsonMessage(runState),
        });
        self.transcriptStore.addMessage(DAVAI_SPEAKER, {
          content: "I'm sorry, I encountered an error. Please try again.",
        });
        self.run = undefined;
        self.setIsLoadingResponse(false);
      }
    });

    const uploadFile = flow(function* () {
      try {
        const fileFromDataUri = yield convertBase64ToImage(self.dataUri);
        const uploadedFile = yield self.apiConnection?.files.create({
          file: fileFromDataUri,
          purpose: "vision"
        });
        return uploadedFile.id;
      }
      catch (err) {
        console.error("Failed to upload image:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to upload image", content: formatJsonMessage(err)});
      }
    });

    const sendFileMessage = flow(function* (fileId) {
      try {
        const res = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: [
            {
              type: "text",
              text: "This is an image of a graph. Describe it for the user."
            },
            {
              type: "image_file",
              image_file: {
                file_id: fileId
              }
            }
          ]
        });
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Image uploaded", content: formatJsonMessage(res)});
      } catch (err) {
        console.error("Failed to send file message:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to send file message", content: formatJsonMessage(err)});
      }
    });

    const handleRequiredAction = flow(function* (runState) {
      try {
        const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
          ? yield Promise.all(
            runState.required_action.submit_tool_outputs.tool_calls.map(flow(function* (toolCall: any) {
              if (toolCall.function.name === "create_request") {
                const { action, resource, values } = JSON.parse(toolCall.function.arguments);
                const request = { action, resource, values };
                self.transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Request sent to CODAP", content: formatJsonMessage(request) });
                let res = yield codapInterface.sendRequest(request);
                // Prepare for uploading of image file after run if the request is to get dataDisplay
                const isImageSnapshotRequest = action === "get" && resource.match(/^dataDisplay/);
                if (isImageSnapshotRequest) {
                  self.uploadFileAfterRun = true;
                  self.dataUri = res.values.exportDataUri;
                }
                self.transcriptStore.addMessage(DEBUG_SPEAKER, { description: "Response from CODAP", content: formatJsonMessage(res) });
                // remove any exportDataUri value that exists since it can be large and we don't need to send it to the assistant
                res = isImageSnapshotRequest
                  ? { ...res, values: { ...res.values, exportDataUri: undefined } }
                  : res;
                return { tool_call_id: toolCall.id, output: JSON.stringify(res) };
              } else {
                return { tool_call_id: toolCall.id, output: "Tool call not recognized." };
              }
            })
          ))
          : [];

        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Tool outputs being submitted", content: formatJsonMessage(toolOutputs)});
        if (toolOutputs) {
          const submittedToolOutputsRes = yield self.apiConnection.beta.threads.runs.submitToolOutputs(
            self.thread.id, self.run.id, { tool_outputs: toolOutputs }
          );
          self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Tool outputs received", content: formatJsonMessage(submittedToolOutputsRes)});
        }
      } catch (err) {
        console.error(err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Error taking required action", content: formatJsonMessage(err)});
        self.run = undefined;
        self.setIsLoadingResponse(false);
      }
    });

    const createThread = flow(function* () {
      try {
        const newThread = yield self.apiConnection.beta.threads.create();
        self.thread = newThread;
        self.run = undefined;
        self.isLoadingResponse = false;
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
        yield self.apiConnection.beta.threads.del(threadId);
        self.thread = undefined;
        self.run = undefined;
        self.isLoadingResponse = false;
      } catch (err) {
        console.error("Error deleting thread:", err);
      }
    });

    return { createThread, deleteThread, initializeAssistant, handleMessageSubmit, sendDataCtxChangeInfo, sendCODAPDocumentInfo, cancelRun };
  })
  .actions((self) => ({
    afterCreate() {
      onSnapshot(self, async () => {
        if (!self.isLoadingResponse && self.codapNotificationQueue.length > 0) {
          const allMsgs = self.codapNotificationQueue.join("\n");
          self.codapNotificationQueue.clear();
          await self.sendCODAPDocumentInfo(allMsgs);
        }
      });
    }
  }));

export interface AssistantModelType extends Instance<typeof AssistantModel> {}
