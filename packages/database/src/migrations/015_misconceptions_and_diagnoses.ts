import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration015: Migration = {
  version: 15,
  name: '015_misconceptions_and_diagnoses',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS misconceptions (
        id TEXT PRIMARY KEY,
        knowledge_node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        correction_strategy TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_misconceptions (
        user_id TEXT NOT NULL,
        misconception_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'suspected',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        PRIMARY KEY (user_id, misconception_id),
        FOREIGN KEY (misconception_id) REFERENCES misconceptions (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS learning_diagnoses (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        knowledge_node_id TEXT NOT NULL,
        type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'suspected',
        source_evidence_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        FOREIGN KEY (session_id) REFERENCES learning_sessions (id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_misconceptions_node ON misconceptions(knowledge_node_id);
      CREATE INDEX IF NOT EXISTS idx_user_misconceptions_user_node ON user_misconceptions(user_id, misconception_id);
      CREATE INDEX IF NOT EXISTS idx_learning_diagnoses_session_user ON learning_diagnoses(session_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_learning_diagnoses_status ON learning_diagnoses(status);
    `);
  },
};
