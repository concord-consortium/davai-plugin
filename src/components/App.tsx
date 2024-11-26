import React, { useEffect, useRef, useState } from "react";
import { initializePlugin, getAllItems, getAttributeList, getDataContext, IResult, selectSelf } from "@concord-consortium/codap-plugin-api";
import { TextContentBlock } from "openai/resources/beta/threads/messages";
// import { ReadAloudMenu } from "./readaloud-menu";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ChatTranscript, ChatMessage } from "../types";
import { timeStamp } from "../utils/utils";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";
import { getTools, initLlmConnection } from "../utils/llm-utils";
import { createGraph } from "../utils/codap-utils";

import "./App.scss";

const kPluginName = "DAVAI";
const kVersion = "0.0.1";
const kInitialDimensions = {
  width: 380,
  height: 680
};

export const App = () => {
  const greeting = "Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.";
  const thread = useRef<any>();
  const attributeList = useRef<IResult>();
  const dataContextRef = useRef<any>();
  const [assistant, setAssistant] = useState<any>(null);
  const [chatTranscript, setChatTranscript] = useState<ChatTranscript>({messages: [{speaker: "DAVAI", content: greeting, timestamp: timeStamp()}]});
  const [readAloudEnabled, setReadAloudEnabled] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const isShortcutEnabled = JSON.parse(localStorage.getItem("keyboardShortcutEnabled") || "true");
  const [keyboardShortcutEnabled, setKeyboardShortcutEnabled] = useState(isShortcutEnabled);
  const shortcutKeys = localStorage.getItem("keyboardShortcutKeys") || "ctrl+?";
  const [keyboardShortcutKeys, setKeyboardShortcutKeys] = useState(shortcutKeys);

  const davai = initLlmConnection();

  useEffect(() => {
    initializePlugin({pluginName: kPluginName, version: kVersion, dimensions: kInitialDimensions});
    selectSelf();
  }, []);

  const handleFocusShortcut = () => {
    selectSelf();
  };

  const handleToggleShortcut = () => {
    localStorage.setItem("keyboardShortcutEnabled", JSON.stringify(!keyboardShortcutEnabled));
    setKeyboardShortcutEnabled(!keyboardShortcutEnabled);
  };

  const handleCustomizeShortcut = (shortcut: string) => {
    localStorage.setItem("keyboardShortcutKeys", shortcut);
    setKeyboardShortcutKeys(shortcut);
  };

  const handleSetReadAloudEnabled = () => {
    setReadAloudEnabled(!readAloudEnabled);
  };

  const handleSetPlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  useEffect(() => {
    const initAssistant = async () => {
      const dataContext = await getDataContext("Mammals");
      dataContextRef.current = dataContext;
      const rootCollection = dataContext.values.collections[0];
      const allItems = await getAllItems(dataContext.values.name);
      console.log("All items: ", allItems);
      attributeList.current = await getAttributeList(dataContext.values.name, rootCollection.name);
      const assistantInstructions = "You are DAVAI, an Data Analysis through Voice and Artificial Intelligence partner. You are an intermediary for a user who is blind who wants to interact with data tables in a data analysis app named CODAP. ";
      const tools = getTools();

      const newAssistant = await davai.beta.assistants.create({
        instructions: assistantInstructions,
        model: "gpt-4o-mini",
        tools
      });

      setAssistant(newAssistant);

      thread.current = await davai.beta.threads.create();
    };

    initAssistant();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!assistant) {
    return <div>Loading...</div>;
  }

  const handleChatInputSubmit = async (messageText: string) => {
    // const chatGPTResponse = await openai.chat.completions.create({
    //   model: "gpt-4o-mini",
    //   messages: [{ role: "user", content: messageText }],
    //   stream: false
    // });

    // Update the transcript with the user's message.
    setChatTranscript(prevTranscript => ({
      messages: [...prevTranscript.messages, { speaker: "User", content: messageText, timestamp: timeStamp() }]
    }));

    // Add the message to the thread
    await davai.beta.threads.messages.create(thread.current.id, {
      role: "user",
      content: messageText,
    });

    // Run the assistant
    const run = await davai.beta.threads.runs.create(thread.current.id, { assistant_id: assistant.id });
    let runState = await davai.beta.threads.runs.retrieve(thread.current.id, run.id);

    // Wait for the run to complete
    while (runState.status !== "completed" && runState.status !== "requires_action") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runState = await davai.beta.threads.runs.retrieve(thread.current.id, run.id);
    }

    // If an action is required, run it and send the result to the assistant
    if (runState.status === "requires_action") {
      const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls.map((toolCall: any) => {
        if (toolCall.function.name === "get_attributes") {
          return { tool_call_id: toolCall.id, output: JSON.stringify(attributeList.current?.values) };
        } else {
          const { name, xAttribute, yAttribute } = JSON.parse(toolCall.function.arguments);
          createGraph(dataContextRef.current, name, xAttribute, yAttribute);
          return { tool_call_id: toolCall.id, output: "Graph created." };
        }
      });
      if (toolOutputs) {
        davai.beta.threads.runs.submitToolOutputsStream(
          thread.current.id, run.id, { tool_outputs: toolOutputs }
        );

        const threadMessageList = await davai.beta.threads.messages.list(thread.current.id);
        const threadMessages = threadMessageList.data.map((msg: any) => ({
          role: msg.role,
          content: msg.content[0].text.value,
        }));

        await davai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            ...threadMessages,
            { role: "assistant", content: `The attributes are ${attributeList.current?.values.map((attr: any) => attr.name).join(", ")}` },
          ],
        });
      }
    }

    // Get the last assistant message from the messages array
    const messages = await davai.beta.threads.messages.list(thread.current.id);
    const lastMessageForRun = messages.data.filter(
      (msg) => msg.run_id === run.id && msg.role === "assistant"
    ).pop();

    const davaiResponse = lastMessageForRun
      ? (lastMessageForRun.content[0] as TextContentBlock).text.value
      : `FAKE! The attributes are ${attributeList.current?.values.map((attr: any) => attr.name).join(", ")}`;

    // setTimeout(() => {
      setChatTranscript(prevTranscript => ({
        messages: [...prevTranscript.messages, { speaker: "DAVAI", content: davaiResponse, timestamp: timeStamp() }]
        // messages: [...prevTranscript.messages, mockAiResponse()]
        // messages: [...prevTranscript.messages, { speaker: "DAVAI", content: chatGPTResponse.choices[0]?.message?.content || "Error.", timestamp: timeStamp() }]
      }));
    // }, 1000);
  };

  return (
    <div className="App">
      <header>
        <h1>
          <abbr title="Data Analysis through Voice and Artificial Intelligence">DAVAI</abbr>
          <span>(Data Analysis through Voice and Artificial Intelligence)</span>
        </h1>
      </header>
      <ChatTranscriptComponent chatTranscript={chatTranscript} />
      <ChatInputComponent
        keyboardShortcutEnabled={keyboardShortcutEnabled}
        shortcutKeys={keyboardShortcutKeys}
        onSubmit={handleChatInputSubmit}
        onKeyboardShortcut={handleFocusShortcut}
      />
      <ReadAloudMenu
        enabled={readAloudEnabled}
        onToggle={handleSetReadAloudEnabled}
        playbackSpeed={playbackSpeed}
        onPlaybackSpeedSelect={handleSetPlaybackSpeed}
      />
      <hr />
      <h2>Options</h2>
      <KeyboardShortcutControls
        shortcutEnabled={keyboardShortcutEnabled}
        shortcutKeys={keyboardShortcutKeys}
        onCustomizeShortcut={handleCustomizeShortcut}
        onToggleShortcut={handleToggleShortcut}
      />
    </div>
  );
};
