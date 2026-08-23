import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import { normalizeText } from '../source/source-hash.ts';

export interface Claim {
 id: string;
 knowledgeNodeId: string;
 statement: string;
 normalizedStatement: string;
}

export class ClaimService {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 recordClaim(knowledgeNodeId: string, statement: string): Claim {
  const normalized = normalizeText(statement);

  const existing = this.db
   .prepare(
    `SELECT id, knowledge_node_id, statement, normalized_statement
         FROM claims
         WHERE knowledge_node_id = ? AND normalized_statement = ?
         LIMIT 1`
   )
   .get(knowledgeNodeId, normalized) as
   | { id: string; knowledge_node_id: string; statement: string; normalized_statement: string }
   | undefined;

  if (existing) {
   return {
    id: existing.id,
    knowledgeNodeId: existing.knowledge_node_id,
    statement: existing.statement,
    normalizedStatement: existing.normalized_statement,
   };
  }

  const id = randomUUID();
  this.db
   .prepare(
    `INSERT INTO claims (id, knowledge_node_id, statement, normalized_statement, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
   )
   .run(id, knowledgeNodeId, statement.trim(), normalized);

  return {
   id,
   knowledgeNodeId,
   statement: statement.trim(),
   normalizedStatement: normalized,
  };
 }

 getClaimsForNode(knowledgeNodeId: string): Claim[] {
  const rows = this.db
   .prepare(
    `SELECT id, knowledge_node_id, statement, normalized_statement
         FROM claims
         WHERE knowledge_node_id = ?`
   )
   .all(knowledgeNodeId) as Array<{
    id: string;
    knowledge_node_id: string;
    statement: string;
    normalized_statement: string;
   }>;

  return rows.map((r) => ({
   id: r.id,
   knowledgeNodeId: r.knowledge_node_id,
   statement: r.statement,
   normalizedStatement: r.normalized_statement,
  }));
 }
}
