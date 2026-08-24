import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration017: Migration = {
  version: 17,
  name: '017_learning_evidence_score',
  up: (db: Database) => {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('score')) {
      db.exec('ALTER TABLE learning_evidence ADD COLUMN score REAL;');
    }
  },
};
