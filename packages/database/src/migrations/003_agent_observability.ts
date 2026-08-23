import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration003: Migration = {
  version: 3,
  name: '003_agent_observability_and_traces',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        learning_session_id TEXT NOT NULL,
        runtime TEXT NOT NULL DEFAULT 'pi',
        runtime_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (learning_session_id) REFERENCES learning_sessions (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES learning_sessions (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments TEXT,
        result TEXT,
        status TEXT NOT NULL CHECK (status IN ('success', 'error')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs (session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls (run_id);
    `);
  },
};
