// Turn inputs for the AgentCore container. These mirror the old server's
// MessageJobInput / ToolJobInput (reference/sam-server/src/types.ts) minus the
// job/queue envelope — the client posts one of these to /invocations (or sends it
// over /ws), and `threadId` doubles as the AgentCore runtimeSessionId.

export interface MessageTurnInput {
  kind?: "message";
  llmId: string;
  threadId: string;
  message: string;
  dataContexts?: any[];
  graphs?: any[];
  effort?: string;
}

export interface ToolTurnInput {
  kind: "tool";
  llmId: string;
  threadId: string;
  message: {
    content: string | any[];
    tool_call_id: string;
  };
  effort?: string;
}

export type TurnInput = MessageTurnInput | ToolTurnInput;
