import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration019: Migration = {
  version: 19,
  name: '019_lesson_step_progress',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lesson_step_progress (
        session_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        active_block_id TEXT,
        completed_block_ids TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, lesson_id),
        FOREIGN KEY (session_id) REFERENCES learning_sessions (id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_lesson_step_progress_session
      ON lesson_step_progress (session_id, updated_at);
    `);
  },
};
