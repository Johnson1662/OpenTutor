import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import { normalizeText } from '../source/source-hash.ts';

export type DisambiguationDecision =
 | 'SAME_ENTITY'
 | 'RELATED_ENTITY'
 | 'DIFFERENT_ENTITY'
 | 'UNCERTAIN';

export interface ResolvedEntity {
 id: string;
 title: string;
 isNew: boolean;
 decision: DisambiguationDecision;
}

export class EntityResolver {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 resolve(name: string, description?: string, aliases: string[] = []): ResolvedEntity {
  const normalized = normalizeText(name);

  // 1. Exact alias match -> SAME_ENTITY
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
   // Register any new aliases
   for (const alias of aliases) {
    this.addAlias(aliasRow.id, alias);
   }
   return { id: aliasRow.id, title: aliasRow.title, isNew: false, decision: 'SAME_ENTITY' };
  }

  // 2. Exact node title match -> SAME_ENTITY
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
   for (const alias of aliases) {
    this.addAlias(titleRow.id, alias);
   }
   return { id: titleRow.id, title: titleRow.title, isNew: false, decision: 'SAME_ENTITY' };
  }

  // 3. Search for potential conflicting or similar candidates (e.g. Self Attention vs Cross Attention)
  const existingNodes = this.db
   .prepare(`SELECT id, title FROM knowledge_nodes`)
   .all() as Array<{ id: string; title: string }>;

  let relatedCandidate: { id: string; title: string } | null = null;
  const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter((w) => w.length > 2));

  for (const node of existingNodes) {
   const nodeNorm = normalizeText(node.title);
   if (nodeNorm === normalized) continue;

   const nodeTokens = new Set(nodeNorm.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
   let sharedCount = 0;
   for (const t of tokens) {
    if (nodeTokens.has(t)) sharedCount++;
   }

   if (sharedCount > 0 || nodeNorm.includes(normalized) || normalized.includes(nodeNorm)) {
    relatedCandidate = node;
    break;
   }
  }

  // 4. Create new distinct knowledge node
  const id =
   name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `kn-${randomUUID()}`;
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
   for (const alias of aliases) {
    this.addAlias(id, alias);
   }

   // If a related but distinct entity exists, link with 'related' edge instead of merging
   if (relatedCandidate && relatedCandidate.id !== id) {
    this.db
     .prepare(
      `INSERT OR IGNORE INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
             VALUES (?, ?, 'related', datetime('now'))`
     )
     .run(id, relatedCandidate.id);
   }
  })();

  return {
   id,
   title: name.trim(),
   isNew: true,
   decision: relatedCandidate ? 'RELATED_ENTITY' : 'DIFFERENT_ENTITY',
  };
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
