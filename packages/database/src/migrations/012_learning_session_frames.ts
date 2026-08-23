import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration012: Migration = {
  version: 12,
  name: '012_learning_session_frames',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS learning_session_frames (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        detour_path_node_id TEXT NOT NULL,
        parent_path_node_id TEXT NOT NULL,
        saved_lesson_id TEXT NOT NULL,
        depth INTEGER NOT NULL,
        status TEXT NOT NULL, -- 'active', 'completed', 'cancelled'
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(session_id) REFERENCES learning_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_frames_active ON learning_session_frames(session_id, status);
    `);
  },
};
