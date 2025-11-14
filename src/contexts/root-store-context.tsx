import React, { createContext, useContext, useState } from "react";
import { useAppConfigContext } from "./app-config-context";
import { IRootStore, RootStore } from "../models/root-store";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { timeStamp } from "../utils/utils";

export const RootStoreContext = createContext<IRootStore | null>(null);

interface RootStoreProviderProps {
  children: React.ReactNode;
  rootStore?: IRootStore;
}

export const RootStoreProvider = ({ children, rootStore: providedRootStore }: RootStoreProviderProps) => {
  const appConfig = useAppConfigContext();
  const [rootStore] = useState(() => {
    if (providedRootStore) return providedRootStore;
    return RootStore.create({
      assistantStore: {
        transcriptStore: {
          messages: [
            {
              speaker: DAVAI_SPEAKER,
              messageContent: { content: GREETING },
              timestamp: timeStamp(),
              id: "initial-message",
            },
          ],
        }
      },
      sonificationStore: {
        binValues: {
          values: []
        }
      }
    }, { appConfig });
  });
  return (
    <RootStoreContext.Provider value={rootStore}>
      {children}
    </RootStoreContext.Provider>
  );
};

export const useRootStore = (): IRootStore => {
  const context = useContext(RootStoreContext);
  if (!context) {
    throw new Error("useRootStore must be used within a RootStoreProvider");
  }
  return context;
};
