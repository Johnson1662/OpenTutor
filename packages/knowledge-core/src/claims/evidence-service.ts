import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';

export type EvidenceRelation = 'supports' | 'contradicts' | 'qualifies';

export interface ClaimEvidenceRecord {
 id: string;
 claimId: string;
 documentChunkId: string;
 relation: EvidenceRelation;
 confidence: number;
 isActive: boolean;
 excerpt: string;
 createdAt: string;
}

interface ClaimEvidenceRow {
 id: string;
 claim_id: string;
 document_chunk_id: string;
 relation: string;
 confidence: number;
 is_active: number;
 excerpt: string | null;
 created_at: string;
}

export class EvidenceService {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 linkEvidence(
  claimId: string,
  documentChunkId: string,
  relation: EvidenceRelation = 'supports',
  confidence: number = 1.0,
  isActive: boolean = true,
  excerpt: string = ''
 ): ClaimEvidenceRecord {
  const now = new Date().toISOString();
  const id = `ev-${randomUUID()}`;

  this.db
   .prepare(
    `INSERT INTO claim_evidence (id, claim_id, document_chunk_id, excerpt, relation, confidence, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(claim_id, document_chunk_id) DO UPDATE SET
           relation = excluded.relation,
           confidence = excluded.confidence,
           is_active = excluded.is_active,
           excerpt = excluded.excerpt`
   )
   .run(id, claimId, documentChunkId, excerpt, relation, confidence, isActive ? 1 : 0, now);

  return {
   id,
   claimId,
   documentChunkId,
   relation,
   confidence,
   isActive,
   excerpt,
   createdAt: now,
  };
 }

 getEvidenceForClaim(claimId: string, activeOnly: boolean = true): ClaimEvidenceRecord[] {
  const sql = activeOnly
   ? `SELECT id, claim_id, document_chunk_id, relation, confidence, is_active, excerpt, created_at
         FROM claim_evidence
         WHERE claim_id = ? AND is_active = 1`
   : `SELECT id, claim_id, document_chunk_id, relation, confidence, is_active, excerpt, created_at
         FROM claim_evidence
         WHERE claim_id = ?`;

  const rows = this.db.prepare(sql).all(claimId) as ClaimEvidenceRow[];

  return rows.map((r) => ({
   id: r.id,
   claimId: r.claim_id,
   documentChunkId: r.document_chunk_id,
   relation: r.relation as EvidenceRelation,
   confidence: r.confidence,
   isActive: r.is_active === 1,
   excerpt: r.excerpt ?? '',
   createdAt: r.created_at,
  }));
 }

 getEvidenceForNode(knowledgeNodeId: string, activeOnly: boolean = true): ClaimEvidenceRecord[] {
  const sql = activeOnly
   ? `SELECT ce.id, ce.claim_id, ce.document_chunk_id, ce.relation, ce.confidence, ce.is_active, ce.excerpt, ce.created_at
         FROM claim_evidence ce
         JOIN claims c ON c.id = ce.claim_id
         WHERE c.knowledge_node_id = ? AND ce.is_active = 1`
   : `SELECT ce.id, ce.claim_id, ce.document_chunk_id, ce.relation, ce.confidence, ce.is_active, ce.excerpt, ce.created_at
         FROM claim_evidence ce
         JOIN claims c ON c.id = ce.claim_id
         WHERE c.knowledge_node_id = ?`;

  const rows = this.db.prepare(sql).all(knowledgeNodeId) as ClaimEvidenceRow[];

  return rows.map((r) => ({
   id: r.id,
   claimId: r.claim_id,
   documentChunkId: r.document_chunk_id,
   relation: r.relation as EvidenceRelation,
   confidence: r.confidence,
   isActive: r.is_active === 1,
   excerpt: r.excerpt ?? '',
   createdAt: r.created_at,
  }));
 }

 deactivateEvidenceForChunk(documentChunkId: string): number {
  const res = this.db
   .prepare(`UPDATE claim_evidence SET is_active = 0 WHERE document_chunk_id = ?`)
   .run(documentChunkId);
  return res.changes;
 }
}
