import type { Database } from '@opentutor/database';

export interface KnowledgeEdge {
 fromNodeId: string;
 toNodeId: string;
 relationType: string;
}

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
    `INSERT OR REPLACE INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
         VALUES (?, ?, ?, ?)`
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

 getEdgesForNode(nodeId: string): KnowledgeEdge[] {
  const rows = this.db
   .prepare(
    `SELECT from_node_id, to_node_id, relation_type FROM knowledge_edges
         WHERE to_node_id = ? OR from_node_id = ?`
   )
   .all(nodeId, nodeId) as Array<{ from_node_id: string; to_node_id: string; relation_type: string }>;

  return rows.map((r) => ({
   fromNodeId: r.from_node_id,
   toNodeId: r.to_node_id,
   relationType: r.relation_type,
  }));
 }
}
