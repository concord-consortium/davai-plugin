import { types, flow } from "mobx-state-tree";
import { initLlmConnection, getTools } from "../utils/llm-utils";
import { transcriptStore } from "./chat-transcript-model";
import { getAttributeList, getDataContext } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER } from "../constants";
import { createGraph } from "../utils/codap-utils";

const AssistantModel = types
  .model("AssistantModel", {
    assistant: types.maybe(types.frozen()),
    thread: types.maybe(types.frozen()),
  })
  .actions((self) => {
    const davai = initLlmConnection();

    const initialize = flow(function* () {
      try {
        const tools = getTools();
        const newAssistant = yield davai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: [{
                type: "text",
                text: "You are DAVAI, an Data Analysis through Voice and Artificial Intelligence partner. You are an intermediary for a user who is blind who wants to interact with data tables in a data analysis app named CODAP."
              }]
            }
          ],
          tools,
        });

        self.assistant = newAssistant;
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
      }
    });

    const handleMessageSubmit = flow(function* (messages) {
      try {
        const tools = getTools();

        // Transform messages for the API request.
        const transformedMessages = messages.map((message: any) => ({
          role: message.speaker === "DAVAI" ? "assistant" : "user",
          content: [{ type: "text", text: message.content }],
        }));

        const response = yield davai.chat.completions.create({
          model: "gpt-4o-mini",
          tools,
          messages: transformedMessages,
        });

        if (response?.choices[0]?.finish_reason === "tool_calls") {
          yield handleRequiredAction(response?.choices[0]?.message.tool_calls, messages);
        } else {
          transcriptStore.addMessage(
            DAVAI_SPEAKER,
            response?.choices[0]?.message.content || "Error processing request."
          );
        }
      } catch (err) {
        console.error("Failed to handle message submit:", err);
      }
    });

    const handleRequiredAction = flow(function* (tool_calls, messages) {
      try {
        const toolOutputs = tool_calls
          ? yield Promise.all(
            tool_calls.map(async (toolCall: any) => {
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
          const tools = getTools();

          const newMessage = toolOutputs.map((toolOutput: any) => ({
            role: "system",
            content: [
              { type: "text", text: toolOutput.output },
            ],
          }));

          // Transform existing messages for the API request. They need to be included in the request to maintain context.
          const transformedMessages = messages.map((message: any) => ({
            role: message.speaker === "DAVAI" ? "assistant" : "user",
            content: [
              {
                type: "text",
                text: message.content,
              },
            ],
          }));
          transformedMessages.push(...newMessage);

          const response = yield davai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: transformedMessages,
            tools,
          });

          transcriptStore.addMessage(
            DAVAI_SPEAKER,
            response?.choices[0]?.message.content || "Error processing request."
          );
        }
      } catch (err) {
        console.error(err);
      }
    });

    return { initialize, handleMessageSubmit };
  });

export const assistantStore = AssistantModel.create();
