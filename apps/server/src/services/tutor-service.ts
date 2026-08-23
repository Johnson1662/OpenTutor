import type { TutorAction } from '@opentutor/protocol';
import type { TutorRuntime } from '../runtime/tutor-runtime';

export class TutorService {
  constructor(private readonly runtime: TutorRuntime) {}

  async run(sessionId: string, action: TutorAction) {
    return this.runtime.run(sessionId, action);
  }
}
