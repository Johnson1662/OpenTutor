import type { Database } from './db.ts';
import type { Migration } from './migrations/001_initial_schema.ts';
import { migration001 } from './migrations/001_initial_schema.ts';
import { migration002 } from './migrations/002_domain_invariants.ts';
import { migration003 } from './migrations/003_agent_observability.ts';
import { migration004 } from './migrations/004_knowledge_core.ts';
import { migration005 } from './migrations/005_ai_preferences.ts';
import { migration006 } from './migrations/006_fts5_retrieval.ts';

export const ALL_MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
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
