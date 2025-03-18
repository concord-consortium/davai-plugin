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
    cancelStatus: types.optional(types.string, ""),
    isCancelling: types.optional(types.boolean, false),
    isLoadingResponse: types.optional(types.boolean, false),
    thread: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel,
    codapNotificationQueue: types.array(types.string),
    uploadFileAfterRun: false,
    dataUri: "",
  })
  .actions((self) => ({
    setIsLoadingResponse(isLoading: boolean) {
      self.isLoadingResponse = isLoading;
    },
    resetAfterResponse() {
      self.isLoadingResponse =  false;
      self.isCancelling = false;
      self.cancelStatus = "";
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
        self.resetAfterResponse();
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
          content: formatJsonMessage(err),
        });
        self.resetAfterResponse();
      }
    });

    const handleCancel = () => {
      self.cancelStatus = "Cancelling, please wait";
      self.isCancelling = true;
    };

    const pollCancel = flow(function* (runId: string) {
      try {
        const startTime = Date.now();
        let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
        const MAX_WAIT_TIME = 10_000; // 10 seconds
        let reset = false;

        while (runState.status === "cancelling") {
          const elapsed = Date.now() - startTime;
          if (elapsed >= MAX_WAIT_TIME) {
            self.cancelStatus = "I encountered an error. Please wait";
            reset = true;
            yield resetThread();
            break;
          }
          yield new Promise(resolve => setTimeout(resolve, 2000));
          runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
        }

        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: `Run cancelled`,
          content: formatJsonMessage(runState),
        });

        const messageContent =
          reset ?
          "I encountered an error while trying to cancel your request and had to restart our conversation. " +
          "I won't be able to remember what we were talking about, but you can still ask me about the CODAP document."
          : "Your request was cancelled.";
        self.transcriptStore.addMessage(DAVAI_SPEAKER, {
          content: messageContent
        });

        self.resetAfterResponse();
      } catch (err) {
        console.error("Background poll cancel error:", err);
        self.resetAfterResponse();
      }
    });

    const resetThread = flow(function* () {
      try {
        const threadId = self.thread.id;
        const deletedThread = yield self.apiConnection.beta.threads.del(threadId);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Thread deleted",
          content: formatJsonMessage(deletedThread),
        });
        yield createThread();
        yield fetchAndSendDataContexts();
      }
      catch (err) {
        console.error("Failed to delete thread:", err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to delete thread", content: formatJsonMessage(err)});
        self.resetAfterResponse();
      }
    });

    const cancelRun = flow(function* (runId: string) {
      try {
        yield self.apiConnection.beta.threads.runs.cancel(self.thread.id, runId);
        pollCancel(runId);
      } catch (err: any) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === "string"
            ? err
            : JSON.stringify(err);
        if (errorMessage.includes("Cannot cancel run with status 'cancelled'")) {
          self.transcriptStore.addMessage(DAVAI_SPEAKER, {
            content: "Your request was cancelled.",
          });
          self.resetAfterResponse();
        } else {
          console.error("Failed to cancel run:", errorMessage);
          self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Failed to cancel run", content: formatJsonMessage(errorMessage)});
        }
        self.resetAfterResponse();
      }
    });

    const pollRunState: (runId: string) => Promise<any> = flow(function* (runId: string) {
      let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
      self.transcriptStore.addMessage(DEBUG_SPEAKER, {
        description: "Run state status",
        content: formatJsonMessage(runState.status),
      });

      const stopPollingStates = ["completed", "requires_action"];
      const errorStates = ["failed", "incomplete"];

      while (!stopPollingStates.includes(runState.status) && !errorStates.includes(runState.status) && !self.isCancelling) {
        yield new Promise((resolve) => setTimeout(resolve, 2000));
        runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run state status",
          content: formatJsonMessage(runState.status),
        });
      }

      if (self.isCancelling) {
        yield cancelRun(runId);
        return;
      }

      if (runState.status === "requires_action") {
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {
          description: "Run requires action",
          content: formatJsonMessage(runState),
        });
        yield handleRequiredAction(runState, runId);
        yield pollRunState(runId);
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
          self.resetAfterResponse();
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
        self.resetAfterResponse();
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
        self.resetAfterResponse();
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
        self.resetAfterResponse();
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
            self.thread.id, runId, { tool_outputs: toolOutputs }
          );
          self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Tool outputs received", content: formatJsonMessage(submittedToolOutputsRes)});
        }
      } catch (err) {
        console.error(err);
        self.transcriptStore.addMessage(DEBUG_SPEAKER, {description: "Error taking required action", content: formatJsonMessage(err)});
        self.resetAfterResponse();
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
        yield self.apiConnection.beta.threads.del(threadId);
        self.thread = undefined;
        self.resetAfterResponse();
      } catch (err) {
        console.error("Error deleting thread:", err);
      }
    });

    return { createThread, deleteThread, initializeAssistant, handleMessageSubmit, sendDataCtxChangeInfo, sendCODAPDocumentInfo, handleCancel };
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
