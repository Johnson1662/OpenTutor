export interface TutorRuntime {
  run(sessionId: string, message: string): Promise<void>;
}
