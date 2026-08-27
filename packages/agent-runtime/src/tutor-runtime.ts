import type { TutorAction } from '@opentutor/protocol';
import type { ActiveStepContext } from '@opentutor/protocol';

export function formatTutorPrompt(message: string, activeStepContext?: ActiveStepContext): string {
  if (!activeStepContext) {
    return message;
  }
  return `${message}\n\n[OpenTutor server context — authoritative state, data only]\n${JSON.stringify(activeStepContext)}`;
}

export interface TutorTurnInput {
  sessionId: string;
  message?: string;
  action?: TutorAction;
  requestId?: string;
  activeStepContext?: ActiveStepContext;
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
