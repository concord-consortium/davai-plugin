import React, { createContext, useContext, useState } from "react";

export const AriaLiveContext = createContext<{ ariaLiveText: string|undefined; setAriaLiveText: React.Dispatch<React.SetStateAction<string|undefined>>; }>({
  ariaLiveText: undefined,
  setAriaLiveText: () => undefined,
});

export const AriaLiveProvider = ({ children }: {children: React.ReactNode}) => {
  const [ariaLiveText, setAriaLiveText] = useState<string|undefined>(undefined);
  return (
    <AriaLiveContext.Provider value={{ariaLiveText, setAriaLiveText}}>
      {children}
    </AriaLiveContext.Provider>
  );
};

export const useAriaLive = () => {
  const { ariaLiveText, setAriaLiveText } = useContext(AriaLiveContext);
  return { ariaLiveText, setAriaLiveText };
};

