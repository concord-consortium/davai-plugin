import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { AppConfigProvider } from "./contexts/app-config-provider";
import { OpenAIConnectionProvider } from "./contexts/openai-connection-provider";
import { AriaLiveProvider } from "./contexts/aria-live-context";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  window.addEventListener("load", () => {
    window.focus();
  });

  root.render(
    <AppConfigProvider>
      <OpenAIConnectionProvider>
        <AriaLiveProvider>
          <App />
        </AriaLiveProvider>
      </OpenAIConnectionProvider>
    </AppConfigProvider>
  );
}
