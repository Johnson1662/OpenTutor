import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration007: Migration = {
  version: 7,
  name: '007_agent_session_model_binding',
  up: (db: Database) => {
    // Safely add columns if they do not already exist
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('agent_sessions')")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('provider_id')) {
      db.exec('ALTER TABLE agent_sessions ADD COLUMN provider_id TEXT;');
    }
    if (!columnNames.has('model_id')) {
      db.exec('ALTER TABLE agent_sessions ADD COLUMN model_id TEXT;');
    }
    if (!columnNames.has('thinking_level')) {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN thinking_level TEXT DEFAULT 'medium';");
    }
  },
};
