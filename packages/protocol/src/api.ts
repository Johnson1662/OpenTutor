import type { TutorAction } from './events';

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
