export type BaseJob = {
  messageId: string;
  kind: "message" | "tool";
  status: "queued" | "completed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  cancelled: boolean;
  output?: any;
};

export type MessageJobInput = {
  llmId: string;
  threadId: string;
  message: string;
  dataContexts?: any;
  graphs?: any;
};

export type ToolJobInput = {
  llmId: string;
  threadId: string;
  message: {
    content: string | any[];
    tool_call_id: string;
  };
};

export type MessageJob = BaseJob & {
  kind: "message";
  input: MessageJobInput;
};

export type ToolJob = BaseJob & {
  kind: "tool";
  input: ToolJobInput;
};

export type Job = MessageJob | ToolJob;
