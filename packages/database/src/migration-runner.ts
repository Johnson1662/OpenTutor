import type { Database } from './db.ts';
import type { Migration } from './migrations/001_initial_schema.ts';
import { migration001 } from './migrations/001_initial_schema.ts';
import { migration002 } from './migrations/002_domain_invariants.ts';
import { migration003 } from './migrations/003_agent_observability.ts';
import { migration004 } from './migrations/004_knowledge_core.ts';
import { migration005 } from './migrations/005_ai_preferences.ts';
import { migration006 } from './migrations/006_fts5_retrieval.ts';
import { migration007 } from './migrations/007_agent_session_model_binding.ts';
import { migration008 } from './migrations/008_ai_role_preferences.ts';
import { migration009 } from './migrations/009_claims_and_evidence.ts';
import { migration010 } from './migrations/010_course_pipeline.ts';
import { migration011 } from './migrations/011_course_sources.ts';
import { migration012 } from './migrations/012_learning_session_frames.ts';
import { migration013 } from './migrations/013_learning_evidence.ts';

export const ALL_MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
];

export function runMigrations(db: Database, migrations: Migration[] = ALL_MIGRATIONS): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  let count = 0;
  const insertMigration = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');

  for (const m of migrations) {
    if (!appliedVersions.has(m.version)) {
      const applyTx = db.transaction(() => {
        m.up(db);
        insertMigration.run(m.version, m.name, new Date().toISOString());
      });
      applyTx();
      count++;
    }
  }

  return count;
}
