import type { TutorAction } from './events.ts';

export interface RunTutorActionRequest {
  action: TutorAction;
}

export interface SubmitQuizAnswerRequest {
  answer: string;
}

export interface AcceptedResponse {
  accepted: true;
  requestId: string;
}
