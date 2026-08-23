import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration010: Migration = {
  version: 10,
  name: '010_course_pipeline',
  up: (db: Database) => {
    // 1. Check and add columns to course_edges table
    const edgeCols = db
      .prepare("SELECT name FROM pragma_table_info('course_edges')")
      .all() as Array<{ name: string }>;
    const edgeColSet = new Set(edgeCols.map((c) => c.name));

    if (!edgeColSet.has('from_node_id')) {
      db.exec('ALTER TABLE course_edges ADD COLUMN from_node_id TEXT;');
    }
    if (!edgeColSet.has('to_node_id')) {
      db.exec('ALTER TABLE course_edges ADD COLUMN to_node_id TEXT;');
    }
    if (!edgeColSet.has('relation_type')) {
      db.exec("ALTER TABLE course_edges ADD COLUMN relation_type TEXT DEFAULT 'prerequisite';");
    }

    // 2. Check and add columns to courses table
    const courseCols = db
      .prepare("SELECT name FROM pragma_table_info('courses')")
      .all() as Array<{ name: string }>;
    const courseColSet = new Set(courseCols.map((c) => c.name));

    if (!courseColSet.has('compile_status')) {
      db.exec("ALTER TABLE courses ADD COLUMN compile_status TEXT NOT NULL DEFAULT 'ready';");
    }
    if (!courseColSet.has('compiled_at')) {
      db.exec('ALTER TABLE courses ADD COLUMN compiled_at TEXT;');
    }
    if (!courseColSet.has('compile_error')) {
      db.exec('ALTER TABLE courses ADD COLUMN compile_error TEXT;');
    }

    // 3. Create course_compile_jobs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_compile_jobs (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        progress INTEGER NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT 'initialized',
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_compile_jobs_course ON course_compile_jobs (course_id);
    `);
  },
};
