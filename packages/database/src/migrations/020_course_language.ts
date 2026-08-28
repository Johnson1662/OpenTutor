import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration020: Migration = {
  version: 20,
  name: '020_course_language',
  up: (db: Database) => {
    const cols = db
      .prepare("SELECT name FROM pragma_table_info('courses')")
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'language')) {
      db.exec("ALTER TABLE courses ADD COLUMN language TEXT NOT NULL DEFAULT 'zh';");
    }
  },
};
