import React, { useEffect, useState } from "react";
import FocusTrap from "focus-trap-react";
import { App } from "./App";

export const FocusTrapWrapper: React.FC = () => {
  const [activeTrap, setActiveTrap] = useState(false);

  useEffect(() => {
    setActiveTrap(true);
  }, []);

  const handleSetActiveTrap = (active: boolean) => {
    setActiveTrap(active);
  }

  return (
    <FocusTrap
      active={activeTrap}
      focusTrapOptions={{
        allowOutsideClick: true,
        escapeDeactivates: true,
        onDeactivate: () => setActiveTrap(false),
        onActivate: () => setActiveTrap(true),
      }}
    >
      <App activeTrap={activeTrap} handleSetActiveTrap={handleSetActiveTrap}/>
    </FocusTrap>
  );
};

