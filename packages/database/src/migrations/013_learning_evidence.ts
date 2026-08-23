import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration013: Migration = {
  version: 13,
  name: '013_learning_evidence',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS learning_evidence (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        knowledge_node_id TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        outcome TEXT NOT NULL,
        difficulty REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 1.0,
        weight REAL NOT NULL DEFAULT 1.0,
        assessment_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_learning_evidence_user_node ON learning_evidence(user_id, knowledge_node_id);
      CREATE INDEX IF NOT EXISTS idx_learning_evidence_created ON learning_evidence(created_at);
    `);

    // Safely add columns to user_knowledge_states if they do not already exist
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('user_knowledge_states')")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('mastery_probability')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN mastery_probability REAL NOT NULL DEFAULT 0.5;');
    }
    if (!columnNames.has('alpha')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN alpha REAL NOT NULL DEFAULT 1.0;');
    }
    if (!columnNames.has('beta')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN beta REAL NOT NULL DEFAULT 1.0;');
    }
    if (!columnNames.has('evidence_count')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;');
    }
    if (!columnNames.has('correct_count')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN correct_count INTEGER NOT NULL DEFAULT 0;');
    }
    if (!columnNames.has('incorrect_count')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN incorrect_count INTEGER NOT NULL DEFAULT 0;');
    }
    if (!columnNames.has('stability')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN stability REAL NOT NULL DEFAULT 7.0;');
    }
    if (!columnNames.has('difficulty')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN difficulty REAL NOT NULL DEFAULT 1.0;');
    }
    if (!columnNames.has('last_assessed_at')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN last_assessed_at TEXT;');
    }
    if (!columnNames.has('last_reviewed_at')) {
      db.exec('ALTER TABLE user_knowledge_states ADD COLUMN last_reviewed_at TEXT;');
    }
  },
};
