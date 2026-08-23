import type { LearningEvent, LearningEventType } from '@opentutor/protocol';
import type { EventRepository } from '@opentutor/database';

export class EventBus {
  private readonly listeners = new Map<string, Set<(event: LearningEvent) => void>>();
  private readonly eventRepo: EventRepository;

  constructor(eventRepo: EventRepository) {
    this.eventRepo = eventRepo;
  }

  subscribe(sessionId: string, listener: (event: LearningEvent) => void): () => void {
    let sessionListeners = this.listeners.get(sessionId);
    if (!sessionListeners) {
      sessionListeners = new Set();
      this.listeners.set(sessionId, sessionListeners);
    }
    sessionListeners.add(listener);

    return () => {
      const current = this.listeners.get(sessionId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.listeners.delete(sessionId);
        }
      }
    };
  }

  publish<T>(sessionId: string, type: LearningEventType, data: T): LearningEvent<T> {
    const event = this.eventRepo.appendEvent(sessionId, type, data);
    const sessionListeners = this.listeners.get(sessionId);
    if (sessionListeners) {
      for (const listener of sessionListeners) {
        try {
          listener(event);
        } catch (err) {
          console.error(`Error in SSE listener for session ${sessionId}:`, err);
        }
      }
    }
    return event;
  }

  getEventsSince(sessionId: string, lastSeq: number): LearningEvent[] {
    return this.eventRepo.getEventsSince(sessionId, lastSeq);
  }

  replayMissedEvents(sessionId: string, lastSeq: number, emit: (event: LearningEvent) => void): void {
    const missed = this.eventRepo.getEventsSince(sessionId, lastSeq);
    for (const evt of missed) {
      emit(evt);
    }
  }

  getLastSeq(sessionId: string): number {
    return this.eventRepo.getLastSeq(sessionId);
  }
}
