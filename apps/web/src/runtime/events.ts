import type { LearningEvent } from '@opentutor/protocol';

export function connectSessionEvents(
  sessionId: string,
  onEvent: (event: LearningEvent) => void,
) {
  const source = new EventSource(`/api/sessions/${sessionId}/events`);

  source.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as LearningEvent);
  };

  return () => source.close();
}
