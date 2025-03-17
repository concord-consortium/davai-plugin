import React, { createContext, useContext } from "react";
import { useAssistantStore } from "../hooks/use-assistant-store";
import { AssistantModelType } from "../models/assistant-model";

const AssistantStoreContext = createContext<AssistantModelType | undefined>(undefined);

export const AssistantStoreProvider = ({ children }: {children: React.ReactNode}) => {
  const assistantStore = useAssistantStore();
  return (
    <AssistantStoreContext.Provider value={assistantStore}>
      {children}
    </AssistantStoreContext.Provider>
  );
};

export const useAssistantStoreContext = () => {
  const context = useContext(AssistantStoreContext);
  if (context === undefined) {
    throw new Error("useAssistantStoreContext must be used within an AssistantStoreProvider");
  }
  return context;
};
