import type {
  AcceptedResponse,
  LearningEvent,
  LearningSessionSnapshot,
  RunTutorActionRequest,
  SubmitQuizAnswerRequest,
  TutorAction,
} from '@opentutor/protocol';

export const PROTOTYPE_SESSION_ID = 'prototype';

export async function getPrototypeSession(): Promise<LearningSessionSnapshot> {
  const response = await fetch(`/api/sessions/${PROTOTYPE_SESSION_ID}`);
  if (!response.ok) throw new Error(`Failed to load session: ${response.status}`);
  return response.json();
}

export async function runTutorAction(action: TutorAction): Promise<AcceptedResponse> {
  const body: RunTutorActionRequest = { action };
  const response = await fetch(`/api/sessions/${PROTOTYPE_SESSION_ID}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Tutor action failed: ${response.status}`);
  return response.json();
}

export async function submitQuizAnswer(lessonId: string, blockId: string, answer: string): Promise<AcceptedResponse> {
  const body: SubmitQuizAnswerRequest = { answer };
  const response = await fetch(`/api/lessons/${lessonId}/blocks/${blockId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Quiz submission failed: ${response.status}`);
  return response.json();
}

export async function sendTutorMessage(message: string): Promise<AcceptedResponse> {
  const response = await fetch(`/api/sessions/${PROTOTYPE_SESSION_ID}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error(`Message failed: ${response.status}`);
  return response.json();
}

export function subscribeToLearningEvents(
  afterSeq: number,
  onEvent: (event: LearningEvent) => void,
  onConnectionChange?: (connected: boolean) => void,
) {
  const source = new EventSource(`/api/sessions/${PROTOTYPE_SESSION_ID}/events?after=${afterSeq}`);
  source.onopen = () => onConnectionChange?.(true);
  source.onerror = () => onConnectionChange?.(false);

  const types = [
    'agent.started',
    'agent.text.delta',
    'agent.tool.started',
    'agent.tool.completed',
    'agent.completed',
    'lesson.patch',
    'lesson.updated',
    'path.patch',
    'assessment.completed',
    'knowledge.updated',
    'error',
  ] as const;

  for (const type of types) {
    source.addEventListener(type, (raw) => {
      const message = raw as MessageEvent<string>;
      onEvent(JSON.parse(message.data) as LearningEvent);
    });
  }

  return () => source.close();
}
