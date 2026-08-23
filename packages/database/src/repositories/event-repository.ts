import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LearningEvent, LearningEventType } from '@opentutor/protocol';

interface LearningEventRow {
  id: string;
  seq: number;
  session_id: string;
  type: string;
  timestamp: string;
  data: string;
}

export class EventRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  appendEvent<T = unknown>(sessionId: string, type: LearningEventType, data: T): LearningEvent<T> {
    const appendTx = this.db.transaction(() => {
      const seqRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM learning_events WHERE session_id = ?')
        .get(sessionId) as { next_seq: number };

      const nextSeq = seqRow.next_seq;
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      const serializedData = JSON.stringify(data);

      this.db
        .prepare(
          'INSERT INTO learning_events (id, seq, session_id, type, timestamp, data) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(id, nextSeq, sessionId, type, timestamp, serializedData);

      return {
        id,
        seq: nextSeq,
        type,
        sessionId,
        timestamp,
        data,
      };
    });

    return appendTx();
  }

  getEventsSince(sessionId: string, sinceSeq: number): LearningEvent[] {
    const rows = this.db
      .prepare(
        'SELECT id, seq, session_id, type, timestamp, data FROM learning_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC'
      )
      .all(sessionId, sinceSeq) as LearningEventRow[];

    return rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      type: r.type as LearningEventType,
      sessionId: r.session_id,
      timestamp: r.timestamp,
      data: JSON.parse(r.data),
    }));
  }

  getAllEvents(sessionId: string): LearningEvent[] {
    return this.getEventsSince(sessionId, 0);
  }

  getLastSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS last_seq FROM learning_events WHERE session_id = ?')
      .get(sessionId) as { last_seq: number };

    return row.last_seq;
  }
}
