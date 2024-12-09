import { types, flow, Instance } from "mobx-state-tree";
import { getTools, initLlmConnection } from "../utils/llm-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { Message } from "openai/resources/beta/threads/messages";
import { getAttributeList, getDataContext } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER } from "../constants";
import { createGraph } from "../utils/codap-utils";

export const AssistantModel = types
  .model("AssistantModel", {
    assistant: types.maybe(types.frozen()),
    assistantId: types.string,
    instructions: types.string,
    model: types.string,
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
  .actions((self) => {
    const davai = initLlmConnection();

    const initialize = flow(function* () {
      try {
        const tools = getTools();

        const davaiAssistant = self.useExisting && self.assistantId
          ? yield davai.beta.assistants.retrieve(self.assistantId)
          : yield davai.beta.assistants.create({instructions: self.instructions, model: self.model, tools });

        if (!self.useExisting) {
          self.assistantId = davaiAssistant.id;
        }
        self.assistant = davaiAssistant;
        self.thread = yield davai.beta.threads.create();
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
      }
    });

    const handleMessageSubmit = flow(function* (messageText) {
      try {
        yield davai.beta.threads.messages.create(self.thread.id, {
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
        const run = yield davai.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });

        // Wait for run completion and handle responses
        let runState = yield davai.beta.threads.runs.retrieve(self.thread.id, run.id);
        while (runState.status !== "completed" && runState.status !== "requires_action") {
          runState = yield davai.beta.threads.runs.retrieve(self.thread.id, run.id);
        }

        if (runState.status === "requires_action") {
          yield handleRequiredAction(runState, run.id);
        }

        // Get the last assistant message from the messages array
        const messages = yield davai.beta.threads.messages.list(self.thread.id);
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
            runState.required_action.submit_tool_outputs.tool_calls.map(async (toolCall: any) => {
              if (toolCall.function.name === "get_attributes") {
                const { dataset } = JSON.parse(toolCall.function.arguments);
                // getting the root collection won't always work. what if a user wants the attributes
                // in the Mammals dataset but there is a hierarchy?
                const rootCollection = (await getDataContext(dataset)).values.collections[0];
                const attributeList = await getAttributeList(dataset, rootCollection.name);
                return { tool_call_id: toolCall.id, output: JSON.stringify(attributeList) };
              } else {
                const { dataset, name, xAttribute, yAttribute } = JSON.parse(toolCall.function.arguments);
                createGraph(dataset, name, xAttribute, yAttribute);
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
      }
    });

    const createThread = flow(function* () {
      try {
        const newThread = yield davai.beta.threads.create();
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
