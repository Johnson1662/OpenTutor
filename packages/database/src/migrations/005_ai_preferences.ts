import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration005: Migration = {
  version: 5,
  name: '005_ai_preferences',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        default_provider_id TEXT,
        default_model_id TEXT,
        thinking_level TEXT DEFAULT 'medium',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ai_preferences_user ON ai_preferences (user_id);
    `);
  },
};
