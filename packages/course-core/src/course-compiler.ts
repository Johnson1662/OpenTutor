import type { Database } from '@opentutor/database';
import type { LearningPathNode, UserKnowledgeState } from '@opentutor/protocol';
import { EntityResolver } from '@opentutor/knowledge-core';
import type {
 CompileCourseInput,
 CourseEdge,
 CourseGraph,
 CourseGoalAnalysis,
 CourseNode,
 CourseNodeRole,
} from './course-types.ts';
import type { GoalAnalyzer } from './goal-analyzer.ts';
import { FakeGoalAnalyzer } from './goal-analyzer.ts';

export class CourseCompiler {
 private readonly db: Database;
 private readonly goalAnalyzer: GoalAnalyzer;
 private readonly entityResolver: EntityResolver;

 constructor(
  db: Database,
  goalAnalyzer?: GoalAnalyzer
 ) {
  this.db = db;
  this.goalAnalyzer = goalAnalyzer ?? new FakeGoalAnalyzer();
  this.entityResolver = new EntityResolver(db);
 }

 async compileCourse(input: CompileCourseInput): Promise<{
  courseGraph: CourseGraph;
  initialPath: LearningPathNode[];
  goalAnalysis: CourseGoalAnalysis;
 }> {
  // 1. Analyze user learning goal
  const goalAnalysis = await this.goalAnalyzer.analyzeGoal(input.learningGoal);

  // 2. Resolve target concept names to knowledge nodes in the Global Knowledge Graph
  const targetNodeIds: string[] = [];
  for (const targetName of goalAnalysis.targetConcepts) {
   const entity = this.entityResolver.resolve(targetName);
   targetNodeIds.push(entity.id);
  }

  // 3. Compute transitive prerequisite closure
  const closure = this.resolvePrerequisiteClosure(targetNodeIds);

  // 4. Build and persist course graph projection
  const courseTitle = input.title || `Mastering ${goalAnalysis.targetConcepts[0] ?? 'Course'}`;
  const courseGraph = this.buildCourseGraph(
   input.courseId,
   courseTitle,
   closure.orderedNodeIds,
   targetNodeIds,
   closure.prerequisiteMap
  );

  // 5. Fetch existing user knowledge states if userId is provided
  let userStates: UserKnowledgeState[] = [];
  if (input.userId) {
   const rows = this.db
    .prepare(
     `SELECT knowledge_node_id, status, confidence,
                  mastery_probability, alpha, beta, evidence_count,
                  correct_count, incorrect_count, stability, difficulty,
                  last_assessed_at, last_reviewed_at
           FROM user_knowledge_states WHERE user_id = ?`
    )
    .all(input.userId) as Array<{
     knowledge_node_id: string;
     status: string;
     confidence: number;
     mastery_probability: number | null;
     alpha: number | null;
     beta: number | null;
     evidence_count: number | null;
     correct_count: number | null;
     incorrect_count: number | null;
     stability: number | null;
     difficulty: number | null;
     last_assessed_at: string | null;
     last_reviewed_at: string | null;
    }>;

   userStates = rows.map((r) => ({
    userId: input.userId,
    knowledgeNodeId: r.knowledge_node_id,
    status: r.status as UserKnowledgeState['status'],
    confidence: r.confidence,
    masteryProbability: r.mastery_probability ?? r.confidence,
    alpha: r.alpha ?? 1.0,
    beta: r.beta ?? 1.0,
    evidenceCount: r.evidence_count ?? 0,
    correctCount: r.correct_count ?? 0,
    incorrectCount: r.incorrect_count ?? 0,
    stability: r.stability ?? 7.0,
    difficulty: r.difficulty ?? 1.0,
    lastAssessedAt: r.last_assessed_at ?? undefined,
    lastReviewedAt: r.last_reviewed_at ?? undefined,
   }));
  }

  // 6. Plan personalized initial learning path
  const initialPath = this.planInitialPath(courseGraph, userStates);

  return {
   courseGraph,
   initialPath,
   goalAnalysis,
  };
 }

 private resolvePrerequisiteClosure(targetNodeIds: string[]): {
  orderedNodeIds: string[];
  prerequisiteMap: Map<string, string[]>;
  hasCycle: boolean;
 } {
  const visited = new Set<string>();
  const prerequisiteMap = new Map<string, string[]>();
  const queue = [...targetNodeIds];

  // 1. BFS / Transitive closure over prerequisite edges
  while (queue.length > 0) {
   const current = queue.shift()!;
   if (visited.has(current)) continue;
   visited.add(current);

   const prereqRows = this.db
    .prepare(
     "SELECT from_node_id FROM knowledge_edges " +
      "WHERE to_node_id = ? AND relation_type = 'prerequisite'"
    )
    .all(current) as Array<{ from_node_id: string }>;

   const prereqs = prereqRows.map((r) => r.from_node_id);
   prerequisiteMap.set(current, prereqs);

   for (const p of prereqs) {
    if (!visited.has(p)) {
     queue.push(p);
    }
   }
  }

  // 2. Topological sort over the closure using Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const nodeId of visited) {
   inDegree.set(nodeId, 0);
   adj.set(nodeId, []);
  }

  for (const [toNode, fromNodes] of prerequisiteMap.entries()) {
   for (const fromNode of fromNodes) {
    if (visited.has(fromNode)) {
     adj.get(fromNode)?.push(toNode);
     inDegree.set(toNode, (inDegree.get(toNode) ?? 0) + 1);
    }
   }
  }

  const zeroInDegree: string[] = [];
  for (const [nodeId, deg] of inDegree.entries()) {
   if (deg === 0) {
    zeroInDegree.push(nodeId);
   }
  }

  const orderedNodeIds: string[] = [];
  while (zeroInDegree.length > 0) {
   const u = zeroInDegree.shift()!;
   orderedNodeIds.push(u);

   for (const v of adj.get(u) ?? []) {
    inDegree.set(v, (inDegree.get(v) ?? 0) - 1);
    if (inDegree.get(v) === 0) {
     zeroInDegree.push(v);
    }
   }
  }

  const hasCycle = orderedNodeIds.length !== visited.size;
  // If cycle detected, append any remaining nodes to guarantee full coverage
  if (hasCycle) {
   for (const nodeId of visited) {
    if (!orderedNodeIds.includes(nodeId)) {
     orderedNodeIds.push(nodeId);
    }
   }
  }

  return {
   orderedNodeIds,
   prerequisiteMap,
   hasCycle,
  };
 }

 private buildCourseGraph(
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
     "INSERT INTO courses (id, title, description, created_at) " +
      "VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(id) DO UPDATE SET title = excluded.title"
    )
    .run(courseId, courseTitle, 'Course compiled for ' + courseTitle);

   // Clear existing course nodes and edges for clean compilation
   this.db.prepare('DELETE FROM course_nodes WHERE course_id = ?').run(courseId);
   this.db.prepare('DELETE FROM course_edges WHERE course_id = ?').run(courseId);

   const insertNode = this.db.prepare(
    'INSERT INTO course_nodes (course_id, knowledge_node_id, position) ' +
     'VALUES (?, ?, ?)'
   );
   for (const node of nodes) {
    insertNode.run(courseId, node.knowledgeNodeId, node.position);
   }

   const insertEdge = this.db.prepare(
    'INSERT INTO course_edges (course_id, from_node_id, to_node_id, relation_type) ' +
     'VALUES (?, ?, ?, ?)'
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

 private planInitialPath(
  courseGraph: CourseGraph,
  userStates: UserKnowledgeState[] = []
 ): LearningPathNode[] {
  const masteryMap = new Map<string, UserKnowledgeState>();
  for (const state of userStates) {
   masteryMap.set(state.knowledgeNodeId, state);
  }

  const path: LearningPathNode[] = [];
  let hasCurrent = false;
  let position = 1;

  for (const node of courseGraph.nodes) {
   const state = masteryMap.get(node.knowledgeNodeId);
   const isMastered = state?.status === 'mastered' || (state?.confidence ?? 0) >= 0.8;

   let status: LearningPathNode['status'] = 'upcoming';
   if (isMastered) {
    status = 'completed';
   } else if (!hasCurrent) {
    status = 'current';
    hasCurrent = true;
   }

   path.push({
    id: 'path-node-' + node.knowledgeNodeId,
    knowledgeNodeId: node.knowledgeNodeId,
    title: node.title,
    type: 'main',
    status,
    position,
   });
   position++;
  }

  // If all nodes were mastered, set the last node as current for review
  if (!hasCurrent && path.length > 0) {
   path[path.length - 1]!.status = 'current';
  }

  return path;
 }
}
