import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { AppConfigProvider } from "./contexts/app-config-context";
import { AriaLiveProvider } from "./contexts/aria-live-context";
import { ShortcutsServiceProvider } from "./contexts/shortcuts-service-context";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  root.render(
    <AppConfigProvider>
      <ShortcutsServiceProvider>
        <AriaLiveProvider>
          <App />
        </AriaLiveProvider>
      </ShortcutsServiceProvider>
    </AppConfigProvider>
  );
}
