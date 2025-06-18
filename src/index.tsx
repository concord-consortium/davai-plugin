import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { AppConfigProvider } from "./contexts/app-config-context";
import { OpenAIConnectionProvider } from "./contexts/openai-connection-provider";
import { AriaLiveProvider } from "./contexts/aria-live-context";
import { UserOptionsProvider } from "./contexts/user-options-context";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  root.render(
    <AppConfigProvider>
      <OpenAIConnectionProvider>
        <AriaLiveProvider>
          <UserOptionsProvider>
            <App />
          </UserOptionsProvider>
        </AriaLiveProvider>
      </OpenAIConnectionProvider>
    </AppConfigProvider>
  );
}
