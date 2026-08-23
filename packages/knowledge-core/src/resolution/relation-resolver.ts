import type { Database } from '@opentutor/database';

export class RelationResolver {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 addRelation(
  fromNodeId: string,
  toNodeId: string,
  relationType: 'prerequisite' | 'related' | 'part_of' = 'prerequisite'
 ): void {
  if (fromNodeId === toNodeId) return;

  const now = new Date().toISOString();
  this.db
   .prepare(
    `INSERT INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(from_node_id, to_node_id) DO UPDATE SET
           relation_type = excluded.relation_type`
   )
   .run(fromNodeId, toNodeId, relationType, now);
 }

 getPrerequisites(nodeId: string): string[] {
  const rows = this.db
   .prepare(
    `SELECT from_node_id FROM knowledge_edges
         WHERE to_node_id = ? AND relation_type = 'prerequisite'`
   )
   .all(nodeId) as Array<{ from_node_id: string }>;

  return rows.map((r) => r.from_node_id);
 }
}
