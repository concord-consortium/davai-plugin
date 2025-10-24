export const AppModeValues = ["development", "production", "test"] as const;
export type AppMode = typeof AppModeValues[number];
export const isAppMode = (value: unknown): value is AppMode => {
  return AppModeValues.includes(value as AppMode);
};

export type AppConfig = {
  accessibility: {
    keyboardShortcut: string;
  };
  llmId?: string;
  llmList: Record<string, string>[];
  dimensions: {
    height: number;
    width: number;
  };
  mockAssistant?: boolean;
  mode: AppMode;
};

export type MessageContent = {
  description?: string;
  content: string;
};

export type ChatMessage = {
  messageContent: MessageContent;
  speaker: string;
  timestamp: string;
  id: string;
};

export type ChatTranscript = {
  messages: ChatMessage[];
};

// CODAP API Types //

export interface Attribute {
  name: string;
  formula?: string;
  description?: string;
  type?: string;
  cid?: string;
  precision?: string;
  unit?: string;
  editable?: boolean;
  renameable?: boolean;
  deleteable?: boolean;
  hidden?: boolean;
}

export interface CodapItemValues {
  [attr: string]: any;
}

export interface CodapItem {
  id: number|string;
  values: CodapItemValues;
}

export type Action = "create" | "get" | "update" | "delete";

export interface ICODAPComponentListItem {
  hidden: boolean;
  id: number;
  name: string;
  title: string;
  type: "caseTable" | "graph" | "map" | "text" | "slider";
}

export interface ICODAPGraph {
  backgroundColor?: string;
  cannotClose?: boolean;
  captionAttributeID?: string;
  captionAttributeName?: string;
  dataContext?: string;
  dimensions?: {
    width: number;
    height: number;
  };
  displayOnlySelectedCases?: boolean;
  enableNumberToggle?: boolean;
  filterFormula?: string;
  hiddenCases?: any[];
  id: number;
  legendAttributeID?: number;
  legendAttributeName?: string;
  name?: string;
  numberToggleLastMode?: string;
  plotType?: string;
  pointColor?: string;
  pointSize?: number;
  position?: {
    left: number;
    top: number;
  };
  primaryAxis?: string;
  rightSplitAttributeID?: number;
  rightSplitAttributeName?: string;
  showMeasuresForSelection?: boolean;
  strokeColor?: string;
  strokeSameAsFill?: boolean;
  title?: string;
  topSplitAttributeID?: number;
  topSplitAttributeName?: string;
  transparent?: boolean;
  type?: string;
  xAttributeID?: number;
  xAttributeName?: string;
  xAttributeType?: string;
  xLowerBound?: number;
  xUpperBound?: number;
  y2AttributeID?: number;
  y2AttributeName?: string;
  y2AttributeType?: string;
  y2LowerBound?: number;
  y2UpperBound?: number;
  yAttributeID?: number;
  yAttributeIDs?: number[];
  yAttributeName?: string;
  yAttributeNames?: string[];
  yAttributeType?: string;
  yLowerBound?: number;
  yUpperBound?: number;
}

export type UnivariateNote = {
  freqValue: number;
  panValue: number;
};

export type ScatterNote = {
  voices: {
    freqValue: number;
    panValue: number;
  }[];
};

export interface IGraphAttrData {
  legend?: Record<string, any>;
  rightSplit?: Record<string, any>;
  topSplit?: Record<string, any>;
  xAxis?: Record<string, any>;
  yAxis?: Record<string, any>;
  y2Axis?: Record<string, any>;
}

export interface IToolCallData {
  request: {
    action: string;
    resource: string;
    graphID?: string;
    values?: any;
  };
  tool_call_id: string;
  type: string;
}

export interface IMessageResponse {
  response?: string;
  status?: string;
  tool_call_id?: string;
}

export type ToolOutput = string | Record<string, any>[];
