import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import { normalizeText } from '../source/source-hash.ts';

export interface ResolvedEntity {
 id: string;
 title: string;
 isNew: boolean;
}

export class EntityResolver {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 resolve(name: string, description?: string): ResolvedEntity {
  const normalized = normalizeText(name);

  // 1. Exact alias match
  const aliasRow = this.db
   .prepare(
    `SELECT n.id, n.title
         FROM knowledge_node_aliases a
         JOIN knowledge_nodes n ON n.id = a.knowledge_node_id
         WHERE a.normalized_name = ?
         LIMIT 1`
   )
   .get(normalized) as { id: string; title: string } | undefined;

  if (aliasRow) {
   return { id: aliasRow.id, title: aliasRow.title, isNew: false };
  }

  // 2. Exact node title match
  const titleRow = this.db
   .prepare(
    `SELECT id, title
         FROM knowledge_nodes
         WHERE lower(title) = ?
         LIMIT 1`
   )
   .get(normalized) as { id: string; title: string } | undefined;

  if (titleRow) {
   this.addAlias(titleRow.id, name);
   return { id: titleRow.id, title: titleRow.title, isNew: false };
  }

  // 3. Create new knowledge node and alias
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `kn-${randomUUID()}`;
  const now = new Date().toISOString();

  this.db.transaction(() => {
   this.db
    .prepare(
     `INSERT INTO knowledge_nodes (id, title, description, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             description = COALESCE(excluded.description, knowledge_nodes.description)`
    )
    .run(id, name.trim(), description ?? '', now);

   this.addAlias(id, name);
  })();

  return { id, title: name.trim(), isNew: true };
 }

 addAlias(knowledgeNodeId: string, alias: string): void {
  const normalized = normalizeText(alias);
  if (!normalized) return;

  const id = randomUUID();
  this.db
   .prepare(
    `INSERT INTO knowledge_node_aliases (id, knowledge_node_id, alias, normalized_name, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(normalized_name) DO NOTHING`
   )
   .run(id, knowledgeNodeId, alias.trim(), normalized);
 }
}
