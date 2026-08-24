import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration016: Migration = {
  version: 16,
  name: '016_detour_diagnosis_link',
  up: (db: Database) => {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('learning_session_frames')")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('diagnosis_id')) {
      db.exec('ALTER TABLE learning_session_frames ADD COLUMN diagnosis_id TEXT;');
    }
  },
};
