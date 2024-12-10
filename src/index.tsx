import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { AppConfigProvider } from "./app-config-provider";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  window.addEventListener("load", () => {
    window.focus();
  });

  root.render(
    <AppConfigProvider>
      <App />
    </AppConfigProvider>
  );
}
