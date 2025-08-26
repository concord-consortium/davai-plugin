export interface MessageJobInput {
  llmId: string;
  threadId: string;
  message: string;
  dataContexts?: any[];
  graphs?: any[];
}

export interface ToolJobInput {
  llmId: string;
  threadId: string;
  message: {
    content: string | any[];
    tool_call_id: string;
  };
}

export interface MessageJob {
  message_id: string;
  kind: "message";
  status: string;
  input: MessageJobInput;
  output?: any;
  created_at: string;
  updated_at: string;
  cancelled: boolean;
}

export interface ToolJob {
  message_id: string;
  kind: "tool";
  status: string;
  input: ToolJobInput;
  output?: any;
  created_at: string;
  updated_at: string;
  cancelled: boolean;
}

export type Job = MessageJob | ToolJob;

export interface SQSMessage {
  messageId: string;
}
