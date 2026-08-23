import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration006: Migration = {
  version: 6,
  name: '006_fts5_retrieval',
  up: (db: Database) => {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        node_id UNINDEXED,
        title,
        aliases,
        claims,
        content,
        tokenize='unicode61'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        document_title,
        heading,
        content,
        tokenize='unicode61'
      );
    `);
  },
};
