import type { TutorRuntime } from './tutor-runtime';

export class MockTutorRuntime implements TutorRuntime {
  constructor(private readonly onAction: (message: string) => Promise<void>) {}

  async run(sessionId: string, message: string) {
    await this.onAction(message);
  }
}
