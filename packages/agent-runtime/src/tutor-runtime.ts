import type { TutorAction } from '@opentutor/protocol';

export interface TutorTurnInput {
  sessionId: string;
  message?: string;
  action?: TutorAction;
  requestId?: string;
  onTextDelta?: (delta: string) => void;
  onToolStart?: (toolCallId: string, toolName: string) => void;
  onToolEnd?: (toolCallId: string, toolName: string, success: boolean) => void;
}

export interface TutorTurnResult {
  requestId: string;
  reply: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
}

export interface TutorRuntime {
  runTurn(input: TutorTurnInput): Promise<TutorTurnResult>;
  cancel?(requestId: string): Promise<void>;
  disposeSession?(sessionId: string): Promise<void>;
}
