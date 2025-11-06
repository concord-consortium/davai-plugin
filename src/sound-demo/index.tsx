import React from "react";
import { createRoot } from "react-dom/client";
import { SoundDemo } from "./sound-demo";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  root.render(
    <SoundDemo/>
  );
}

