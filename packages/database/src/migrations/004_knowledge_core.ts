import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration004: Migration = {
  version: 4,
  name: '004_knowledge_core',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        source_uri TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS document_versions (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version INTEGER NOT NULL,
        content_hash TEXT NOT NULL, content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (document_id, content_hash), UNIQUE (document_id, version),
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS document_sections (
        id TEXT PRIMARY KEY, document_version_id TEXT NOT NULL, document_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL, heading TEXT, level INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (document_version_id, ordinal),
        FOREIGN KEY (document_version_id) REFERENCES document_versions (id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY, document_section_id TEXT NOT NULL, document_version_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (document_section_id, ordinal),
        FOREIGN KEY (document_section_id) REFERENCES document_sections (id) ON DELETE CASCADE,
        FOREIGN KEY (document_version_id) REFERENCES document_versions (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS knowledge_node_aliases (
        id TEXT PRIMARY KEY, knowledge_node_id TEXT NOT NULL, alias TEXT NOT NULL,
        normalized_name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (knowledge_node_id, normalized_name), UNIQUE (normalized_name),
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY, knowledge_node_id TEXT, statement TEXT NOT NULL,
        normalized_statement TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS claim_evidence (
        id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, document_chunk_id TEXT NOT NULL,
        excerpt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (claim_id, document_chunk_id),
        FOREIGN KEY (claim_id) REFERENCES claims (id) ON DELETE CASCADE,
        FOREIGN KEY (document_chunk_id) REFERENCES document_chunks (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS knowledge_artifacts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        artifact_type TEXT NOT NULL DEFAULT 'knowledge',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS knowledge_artifact_versions (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version INTEGER NOT NULL,
        content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES knowledge_artifacts (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_document_versions_hash ON document_versions (content_hash);
      CREATE INDEX IF NOT EXISTS idx_document_sections_version ON document_sections (document_version_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_document_chunks_version ON document_chunks (document_version_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_claims_node ON claims (knowledge_node_id);
      CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim ON claim_evidence (claim_id);
    `);
  },
};
