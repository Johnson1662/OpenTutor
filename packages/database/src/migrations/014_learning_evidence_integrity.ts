import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration014: Migration = {
  version: 14,
  name: '014_learning_evidence_integrity',
  up: (db: Database) => {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('source_item_id')) {
      db.exec('ALTER TABLE learning_evidence ADD COLUMN source_item_id TEXT;');
    }
    if (!columnNames.has('attempt')) {
      db.exec('ALTER TABLE learning_evidence ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;');
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_learning_evidence_source_item ON learning_evidence(user_id, knowledge_node_id, source_item_id);
    `);
  },
};
