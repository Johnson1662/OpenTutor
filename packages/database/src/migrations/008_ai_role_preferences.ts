import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration008: Migration = {
  version: 8,
  name: '008_ai_role_preferences',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_role_preferences (
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        thinking_level TEXT NOT NULL DEFAULT 'medium',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, role)
      );

      CREATE INDEX IF NOT EXISTS idx_ai_role_preferences_user ON ai_role_preferences (user_id);
    `);
  },
};
