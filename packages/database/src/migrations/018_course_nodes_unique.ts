import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration018: Migration = {
  version: 18,
  name: '018_course_nodes_unique',
  up: (db: Database) => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='course_nodes'")
      .all() as Array<{ name: string }>;
    const hasUnique = indexes.some((row) => row.name === 'idx_course_nodes_course_knowledge');
    if (hasUnique) return;

    // Remove duplicate course_nodes rows, keeping the lowest id per (course_id, knowledge_node_id).
    db.exec(`
      DELETE FROM course_nodes
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM course_nodes
        GROUP BY course_id, knowledge_node_id
      );
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_course_nodes_course_knowledge
      ON course_nodes (course_id, knowledge_node_id);
    `);
  },
};
