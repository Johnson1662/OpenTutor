import type { LearningEvent } from '@opentutor/protocol';

export class EventBus {
  private listeners = new Set<(event: LearningEvent) => void>();

  subscribe(listener: (event: LearningEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: LearningEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
