import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';

export interface ClaimEvidenceRecord {
 id: string;
 claimId: string;
 documentChunkId: string;
 excerpt: string;
}

export class EvidenceService {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 linkEvidence(claimId: string, documentChunkId: string, excerpt: string): ClaimEvidenceRecord {
  const id = randomUUID();

  this.db
   .prepare(
    `INSERT INTO claim_evidence (id, claim_id, document_chunk_id, excerpt, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(claim_id, document_chunk_id) DO UPDATE SET
           excerpt = excluded.excerpt`
   )
   .run(id, claimId, documentChunkId, excerpt.trim());

  return {
   id,
   claimId,
   documentChunkId,
   excerpt: excerpt.trim(),
  };
 }

 getEvidenceForClaim(claimId: string): ClaimEvidenceRecord[] {
  const rows = this.db
   .prepare(
    `SELECT id, claim_id, document_chunk_id, excerpt
         FROM claim_evidence
         WHERE claim_id = ?`
   )
   .all(claimId) as Array<{
    id: string;
    claim_id: string;
    document_chunk_id: string;
    excerpt: string;
   }>;

  return rows.map((r) => ({
   id: r.id,
   claimId: r.claim_id,
   documentChunkId: r.document_chunk_id,
   excerpt: r.excerpt,
  }));
 }

 getEvidenceForNode(knowledgeNodeId: string): ClaimEvidenceRecord[] {
  const rows = this.db
   .prepare(
    `SELECT ce.id, ce.claim_id, ce.document_chunk_id, ce.excerpt
         FROM claim_evidence ce
         JOIN claims c ON c.id = ce.claim_id
         WHERE c.knowledge_node_id = ?`
   )
   .all(knowledgeNodeId) as Array<{
    id: string;
    claim_id: string;
    document_chunk_id: string;
    excerpt: string;
   }>;

  return rows.map((r) => ({
   id: r.id,
   claimId: r.claim_id,
   documentChunkId: r.document_chunk_id,
   excerpt: r.excerpt,
  }));
 }
}
