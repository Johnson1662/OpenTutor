import type { Database } from '@opentutor/database';
import type { CourseGraph, CourseNode, CourseEdge, CourseNodeRole } from './course-types.ts';

export class GraphBuilder {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 buildCourseGraph(
  courseId: string,
  courseTitle: string,
  orderedNodeIds: string[],
  targetNodeIds: string[],
  prerequisiteMap: Map<string, string[]>
 ): CourseGraph {
  const targetSet = new Set(targetNodeIds);
  const nodes: CourseNode[] = [];
  const edges: CourseEdge[] = [];

  // 1. Fetch titles for all nodes in the closure
  let position = 1;
  for (const nodeId of orderedNodeIds) {
   const row = this.db
    .prepare('SELECT title FROM knowledge_nodes WHERE id = ?')
    .get(nodeId) as { title: string } | undefined;

   const title = row?.title ?? nodeId;
   const role: CourseNodeRole = targetSet.has(nodeId) ? 'core' : 'prerequisite';

   nodes.push({
    courseId,
    knowledgeNodeId: nodeId,
    title,
    role,
    position,
   });
   position++;
  }

  // 2. Build course edges
  for (const [toNode, fromNodes] of prerequisiteMap.entries()) {
   for (const fromNode of fromNodes) {
    if (orderedNodeIds.includes(fromNode) && orderedNodeIds.includes(toNode)) {
     edges.push({
      courseId,
      fromNodeId: fromNode,
      toNodeId: toNode,
      relationType: 'prerequisite',
     });
    }
   }
  }

  // 3. Persist course projection into SQLite
  this.db.transaction(() => {
   // Upsert course record
   this.db
    .prepare(
     `INSERT INTO courses (id, title, description, created_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET title = excluded.title`
    )
    .run(courseId, courseTitle, `Course compiled for ${courseTitle}`);

   // Clear existing course nodes and edges for clean compilation
   this.db.prepare('DELETE FROM course_nodes WHERE course_id = ?').run(courseId);
   this.db.prepare('DELETE FROM course_edges WHERE course_id = ?').run(courseId);

   const insertNode = this.db.prepare(
    `INSERT INTO course_nodes (course_id, knowledge_node_id, position)
         VALUES (?, ?, ?)`
   );
   for (const node of nodes) {
    insertNode.run(courseId, node.knowledgeNodeId, node.position);
   }

   const insertEdge = this.db.prepare(
    `INSERT INTO course_edges (course_id, from_node_id, to_node_id, relation_type)
         VALUES (?, ?, ?, ?)`
   );
   for (const edge of edges) {
    insertEdge.run(courseId, edge.fromNodeId, edge.toNodeId, edge.relationType ?? 'prerequisite');
   }
  })();

  return {
   courseId,
   title: courseTitle,
   nodes,
   edges,
  };
 }
}
