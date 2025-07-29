import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { AppConfigProvider } from "./contexts/app-config-provider";
import { AriaLiveProvider } from "./contexts/aria-live-context";
import { UserOptionsProvider } from "./contexts/user-options-context";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  root.render(
    <AppConfigProvider>
      <AriaLiveProvider>
        <UserOptionsProvider>
          <App />
        </UserOptionsProvider>
      </AriaLiveProvider>
    </AppConfigProvider>
  );
}
