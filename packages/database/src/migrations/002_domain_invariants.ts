import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration002: Migration = {
  version: 2,
  name: '002_domain_invariants_and_edges',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (from_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE,
        FOREIGN KEY (to_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_edges_from ON knowledge_edges (from_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON knowledge_edges (to_node_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_from_to_rel ON knowledge_edges (from_node_id, to_node_id, relation_type);
    `);
  },
};
