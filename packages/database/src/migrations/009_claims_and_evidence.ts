import type { Database } from '../db.ts';
import type { Migration } from './001_initial_schema.ts';

export const migration009: Migration = {
  version: 9,
  name: '009_claims_and_evidence',
  up: (db: Database) => {
    // 1. Check and add columns to claims table
    const claimCols = db
      .prepare("SELECT name FROM pragma_table_info('claims')")
      .all() as Array<{ name: string }>;
    const claimColSet = new Set(claimCols.map((c) => c.name));

    if (!claimColSet.has('status')) {
      db.exec("ALTER TABLE claims ADD COLUMN status TEXT NOT NULL DEFAULT 'supported';");
    }
    if (!claimColSet.has('confidence')) {
      db.exec("ALTER TABLE claims ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;");
    }
    if (!claimColSet.has('updated_at')) {
      db.exec("ALTER TABLE claims ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));");
    }

    // 2. Check and add columns to claim_evidence table
    const evidenceCols = db
      .prepare("SELECT name FROM pragma_table_info('claim_evidence')")
      .all() as Array<{ name: string }>;
    const evidenceColSet = new Set(evidenceCols.map((c) => c.name));

    if (!evidenceColSet.has('relation')) {
      db.exec("ALTER TABLE claim_evidence ADD COLUMN relation TEXT NOT NULL DEFAULT 'supports';");
    }
    if (!evidenceColSet.has('confidence')) {
      db.exec("ALTER TABLE claim_evidence ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;");
    }
    if (!evidenceColSet.has('is_active')) {
      db.exec("ALTER TABLE claim_evidence ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
    }

    // 3. Check and add columns to document_versions table
    const docVerCols = db
      .prepare("SELECT name FROM pragma_table_info('document_versions')")
      .all() as Array<{ name: string }>;
    const docVerColSet = new Set(docVerCols.map((c) => c.name));

    if (!docVerColSet.has('status')) {
      db.exec("ALTER TABLE document_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
    }

    // 4. Check and add columns to knowledge_artifacts table
    const artifactCols = db
      .prepare("SELECT name FROM pragma_table_info('knowledge_artifacts')")
      .all() as Array<{ name: string }>;
    const artifactColSet = new Set(artifactCols.map((c) => c.name));

    if (!artifactColSet.has('knowledge_node_id')) {
      db.exec("ALTER TABLE knowledge_artifacts ADD COLUMN knowledge_node_id TEXT;");
    }
    if (!artifactColSet.has('version')) {
      db.exec("ALTER TABLE knowledge_artifacts ADD COLUMN version INTEGER DEFAULT 1;");
    }
    if (!artifactColSet.has('content_hash')) {
      db.exec("ALTER TABLE knowledge_artifacts ADD COLUMN content_hash TEXT;");
    }
    if (!artifactColSet.has('content_json')) {
      db.exec("ALTER TABLE knowledge_artifacts ADD COLUMN content_json TEXT;");
    }

    // 5. Ensure indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_claim_evidence_active ON claim_evidence (is_active);
      CREATE INDEX IF NOT EXISTS idx_claims_status ON claims (status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_artifacts_node ON knowledge_artifacts (knowledge_node_id);
    `);
  },
};
