import React from "react";
import { createRoot } from "react-dom/client";
import { LoopDemo } from "./loop-demo";
import { TransportDemo } from "./transport-demo";

import "./index.scss";

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);

  root.render(
    <>
      <LoopDemo/>
      <TransportDemo/>
    </>
  );
}

