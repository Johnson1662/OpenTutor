import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration011: Migration = {
  version: 11,
  name: '011_course_sources',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_sources (
        course_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (course_id, document_id),
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_course_sources_course ON course_sources (course_id);
      CREATE INDEX IF NOT EXISTS idx_course_sources_doc ON course_sources (document_id);
    `);
  },
};
