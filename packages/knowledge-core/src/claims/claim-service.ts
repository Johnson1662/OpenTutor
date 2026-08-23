import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import { normalizeText } from '../source/source-hash.ts';

export type ClaimStatus = 'supported' | 'uncertain' | 'conflicting' | 'deprecated';

export interface Claim {
 id: string;
 knowledgeNodeId: string;
 statement: string;
 normalizedStatement: string;
 status: ClaimStatus;
 confidence: number;
 createdAt: string;
 updatedAt: string;
}

interface ClaimRow {
 id: string;
 knowledge_node_id: string;
 statement: string;
 normalized_statement: string;
 status: string;
 confidence: number;
 created_at: string;
 updated_at: string;
}

export class ClaimService {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 recordClaim(
  knowledgeNodeId: string,
  statement: string,
  status: ClaimStatus = 'supported',
  confidence: number = 1.0
 ): Claim {
  const normalized = normalizeText(statement);
  const now = new Date().toISOString();

  const existing = this.db
   .prepare(
    `SELECT id, knowledge_node_id, statement, normalized_statement, status, confidence, created_at, updated_at
         FROM claims
         WHERE knowledge_node_id = ? AND normalized_statement = ?
         LIMIT 1`
   )
   .get(knowledgeNodeId, normalized) as ClaimRow | undefined;

  if (existing) {
   return {
    id: existing.id,
    knowledgeNodeId: existing.knowledge_node_id,
    statement: existing.statement,
    normalizedStatement: existing.normalized_statement,
    status: existing.status as ClaimStatus,
    confidence: existing.confidence,
    createdAt: existing.created_at,
    updatedAt: existing.updated_at,
   };
  }

  const id = `claim-${randomUUID()}`;
  this.db
   .prepare(
    `INSERT INTO claims (id, knowledge_node_id, statement, normalized_statement, status, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
   )
   .run(id, knowledgeNodeId, statement.trim(), normalized, status, confidence, now, now);

  return {
   id,
   knowledgeNodeId,
   statement: statement.trim(),
   normalizedStatement: normalized,
   status,
   confidence,
   createdAt: now,
   updatedAt: now,
  };
 }

 updateClaimStatus(id: string, status: ClaimStatus, confidence?: number): void {
  const now = new Date().toISOString();
  if (confidence !== undefined) {
   this.db
    .prepare(`UPDATE claims SET status = ?, confidence = ?, updated_at = ? WHERE id = ?`)
    .run(status, confidence, now, id);
  } else {
   this.db
    .prepare(`UPDATE claims SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now, id);
  }
 }

 getClaimsForNode(knowledgeNodeId: string, activeOnly: boolean = false): Claim[] {
  const sql = activeOnly
   ? `SELECT c.id, c.knowledge_node_id, c.statement, c.normalized_statement, c.status, c.confidence, c.created_at, c.updated_at
         FROM claims c
         WHERE c.knowledge_node_id = ? AND c.status != 'deprecated'`
   : `SELECT id, knowledge_node_id, statement, normalized_statement, status, confidence, created_at, updated_at
         FROM claims
         WHERE knowledge_node_id = ?`;

  const rows = this.db.prepare(sql).all(knowledgeNodeId) as ClaimRow[];

  return rows.map((r) => ({
   id: r.id,
   knowledgeNodeId: r.knowledge_node_id,
   statement: r.statement,
   normalizedStatement: r.normalized_statement,
   status: r.status as ClaimStatus,
   confidence: r.confidence,
   createdAt: r.created_at,
   updatedAt: r.updated_at,
  }));
 }

 getClaimById(id: string): Claim | null {
  const row = this.db
   .prepare(
    `SELECT id, knowledge_node_id, statement, normalized_statement, status, confidence, created_at, updated_at
         FROM claims
         WHERE id = ?`
   )
   .get(id) as ClaimRow | undefined;

  if (!row) return null;
  return {
   id: row.id,
   knowledgeNodeId: row.knowledge_node_id,
   statement: row.statement,
   normalizedStatement: row.normalized_statement,
   status: row.status as ClaimStatus,
   confidence: row.confidence,
   createdAt: row.created_at,
   updatedAt: row.updated_at,
  };
 }
}
