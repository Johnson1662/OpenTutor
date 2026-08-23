import type { TutorTurnInput } from '../tutor-runtime.ts';

export interface PiEvent {
  type: string;
  [key: string]: unknown;
}

export class PiEventAdapter {
  private readonly input: TutorTurnInput;

  constructor(input: TutorTurnInput) {
    this.input = input;
  }

  handleEvent(event: PiEvent): void {
    switch (event.type) {
      case 'text_delta':
      case 'content_delta': {
        if (typeof event.delta === 'string') {
          this.input.onTextDelta?.(event.delta);
        } else if (typeof event.text === 'string') {
          this.input.onTextDelta?.(event.text);
        }
        break;
      }
      case 'message_update': {
        if (event.assistantMessageEvent && typeof event.assistantMessageEvent === 'object') {
          const inner = event.assistantMessageEvent as { type?: string; delta?: string };
          if (inner.type === 'text_delta' && typeof inner.delta === 'string') {
            this.input.onTextDelta?.(inner.delta);
          }
        }
        break;
      }
      case 'tool_call_start': {
        const id = (typeof event.toolCallId === 'string' ? event.toolCallId : typeof event.id === 'string' ? event.id : 'unknown-tc');
        const name = (typeof event.toolName === 'string' ? event.toolName : typeof event.name === 'string' ? event.name : 'unknown-tool');
        this.input.onToolStart?.(id, name);
        break;
      }
      case 'tool_call_end': {
        const id = (typeof event.toolCallId === 'string' ? event.toolCallId : typeof event.id === 'string' ? event.id : 'unknown-tc');
        const name = (typeof event.toolName === 'string' ? event.toolName : typeof event.name === 'string' ? event.name : 'unknown-tool');
        const success = event.isError !== true && event.error === undefined;
        this.input.onToolEnd?.(id, name, success);
        break;
      }
      default:
        break;
    }
  }
}
