import type { Database } from '@opentutor/database';

export interface PrerequisiteClosureResult {
 orderedNodeIds: string[];
 prerequisiteMap: Map<string, string[]>;
 hasCycle: boolean;
}

export class PrerequisiteResolver {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 resolveClosure(targetNodeIds: string[]): PrerequisiteClosureResult {
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
     `SELECT from_node_id FROM knowledge_edges
           WHERE to_node_id = ? AND relation_type = 'prerequisite'`
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
}
