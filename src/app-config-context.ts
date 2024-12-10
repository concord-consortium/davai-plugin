import { createContext } from "react";
import { AppConfigModelType } from "./models/app-config-model";

export const AppConfigContext = createContext<AppConfigModelType | undefined>(undefined);
