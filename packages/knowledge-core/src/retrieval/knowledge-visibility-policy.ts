import type { Database } from '@opentutor/database';

export class KnowledgeVisibilityPolicy {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 isNodeVisible(nodeId: string): boolean {
  const activeEvidence = (
   this.db
    .prepare(
     `SELECT count(*) AS total FROM claim_evidence ce
           JOIN claims c ON c.id = ce.claim_id
           WHERE c.knowledge_node_id = ? AND ce.is_active = 1`
    )
    .get(nodeId) as { total: number } | undefined
  )?.total ?? 0;

  if (activeEvidence > 0) {
   return true;
  }

  const activeClaims = (
   this.db
    .prepare(
     `SELECT count(*) AS total FROM claims
           WHERE knowledge_node_id = ? AND status != 'deprecated'`
    )
    .get(nodeId) as { total: number } | undefined
  )?.total ?? 0;

  return activeClaims > 0;
 }
}
