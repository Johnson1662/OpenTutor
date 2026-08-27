import type { Database } from '@opentutor/database';
import { ArtifactCompiler } from '../artifacts/artifact-compiler.ts';
import type { KnowledgeArtifact } from '../artifacts/artifact-schema.ts';
import { ClaimService } from '../claims/claim-service.ts';
import { EvidenceService } from '../claims/evidence-service.ts';
import { RelationResolver } from '../resolution/relation-resolver.ts';
import type { SourceChunk } from '../source/markdown-parser.ts';
import { normalizeText } from '../source/source-hash.ts';

export interface KnowledgeSearchResultItem {
 nodeId: string;
 title: string;
 summary: string;
 matchedClaims: string[];
 evidenceCount: number;
}

export interface NeighborResult {
 nodeId: string;
 title: string;
 relation: string;
}

export class SearchService {
 private readonly db: Database;
 private readonly artifactCompiler: ArtifactCompiler;

 constructor(
  db: Database,
  artifactCompiler?: ArtifactCompiler
 ) {
  this.db = db;
  this.artifactCompiler =
   artifactCompiler ??
   new ArtifactCompiler(
    db,
    new ClaimService(db),
    new EvidenceService(db),
    new RelationResolver(db)
   );
 }

 // 1. knowledge_search
 knowledgeSearch(query: string, limit: number = 5): KnowledgeSearchResultItem[] {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  let nodeIds: string[] = [];

  // Attempt FTS5 MATCH
  try {
   const ftsWords = cleanQuery.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, ' ').trim().split(/\s+/).filter(Boolean);
   if (ftsWords.length > 0) {
    const matchExpr = ftsWords.join(' OR ');
    const ftsRows = this.db
     .prepare(
      `SELECT node_id FROM knowledge_fts
             WHERE knowledge_fts MATCH ?
             LIMIT ?`
     )
     .all(matchExpr, limit) as Array<{ node_id: string }>;

    nodeIds = ftsRows.map((r) => r.node_id);
   }
  } catch {
   nodeIds = [];
  }

  // Fallback to LIKE if FTS5 had no matches
  if (nodeIds.length === 0) {
   const likePattern = `%${normalizeText(cleanQuery)}%`;
   const likeRows = this.db
    .prepare(
     `SELECT id FROM knowledge_nodes
           WHERE lower(title) LIKE ? OR lower(COALESCE(description, '')) LIKE ?
           LIMIT ?`
    )
    .all(likePattern, likePattern, limit) as Array<{ id: string }>;

   nodeIds = likeRows.map((r) => r.id);
  }

  const results: KnowledgeSearchResultItem[] = [];

  for (const nodeId of nodeIds) {
   if (!this.isNodeVisible(nodeId)) {
    continue;
   }

   const node = this.db
    .prepare('SELECT id, title, description FROM knowledge_nodes WHERE id = ?')
    .get(nodeId) as { id: string; title: string; description: string | null } | undefined;

   if (!node) continue;

   // Filter out claims that have status = 'deprecated'
   const claimsRows = this.db
    .prepare("SELECT statement FROM claims WHERE knowledge_node_id = ? AND status != 'deprecated' LIMIT 3")
    .all(nodeId) as Array<{ statement: string }>;

   // Only count active evidence
   const evidenceCount = (
    this.db
     .prepare(
      `SELECT count(*) AS total FROM claim_evidence ce
             JOIN claims c ON c.id = ce.claim_id
             WHERE c.knowledge_node_id = ? AND ce.is_active = 1`
     )
     .get(nodeId) as { total: number }
   ).total;

   const artifact = this.artifactRead(nodeId);

   results.push({
    nodeId: node.id,
    title: node.title,
    summary: artifact?.intuition.text ?? node.description ?? node.title,
    matchedClaims: claimsRows.map((c) => c.statement),
    evidenceCount,
   });
  }

  return results;
 }

 // 2. artifact_read
 artifactRead(nodeId: string): KnowledgeArtifact | null {
  if (!this.isNodeVisible(nodeId)) {
   return null;
  }

  const artifact = this.artifactCompiler.getLatestArtifact(nodeId);
  if (!artifact) return null;

  return artifact;
 }

 // 3. source_search
 sourceSearch(query: string, limit: number = 5): Array<{ chunkId: string; documentTitle: string; heading?: string; snippet: string }> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  let rows: Array<{ chunk_id: string; document_title: string; heading: string | null; content: string }> = [];

  // 1. Try FTS5 MATCH with active document_versions filter
  try {
   const ftsWords = cleanQuery.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, ' ').trim().split(/\s+/).filter(Boolean);
   if (ftsWords.length > 0) {
    const matchExpr = ftsWords.join(' OR ');
    rows = this.db
     .prepare(
      `SELECT c.id AS chunk_id, d.title AS document_title, s.heading, c.content
             FROM source_fts f
             JOIN document_chunks c ON c.id = f.chunk_id
             JOIN document_sections s ON s.id = c.document_section_id
             JOIN document_versions dv ON dv.id = c.document_version_id
             JOIN documents d ON d.id = dv.document_id
             WHERE source_fts MATCH ? AND dv.status = 'active'
             LIMIT ?`
     )
     .all(matchExpr, limit) as typeof rows;
   }
  } catch {
   rows = [];
  }

  // 2. Fallback to LIKE if FTS5 yielded no results with active document_versions filter
  if (rows.length === 0) {
   const clean = `%${normalizeText(cleanQuery)}%`;
   rows = this.db
    .prepare(
     `SELECT c.id AS chunk_id, d.title AS document_title, s.heading, c.content
           FROM document_chunks c
           JOIN document_sections s ON s.id = c.document_section_id
           JOIN document_versions dv ON dv.id = c.document_version_id
           JOIN documents d ON d.id = dv.document_id
           WHERE (lower(c.content) LIKE ? OR lower(COALESCE(s.heading, '')) LIKE ?)
             AND dv.status = 'active'
           LIMIT ?`
    )
    .all(clean, clean, limit) as typeof rows;
  }

  return rows.map((r) => ({
   chunkId: r.chunk_id,
   documentTitle: r.document_title,
   heading: r.heading ?? undefined,
   snippet: r.content.slice(0, 300),
  }));
 }

 // 4. source_read
 sourceRead(chunkId: string): SourceChunk | null {
  const row = this.db
   .prepare(
    `SELECT c.id, c.ordinal, s.heading, s.level, c.content, c.content_hash
         FROM document_chunks c
         JOIN document_sections s ON s.id = c.document_section_id
         JOIN document_versions dv ON dv.id = c.document_version_id
         WHERE c.id = ? AND dv.status = 'active'`
   )
   .get(chunkId) as
   | { id: string; ordinal: number; heading: string | null; level: number; content: string; content_hash: string }
   | undefined;

  if (!row) return null;

  return {
   id: row.id,
   ordinal: row.ordinal,
   heading: row.heading ?? undefined,
   level: row.level,
   content: row.content,
   contentHash: row.content_hash,
  };
 }

 // 5. graph_neighbors
 graphNeighbors(nodeId: string, direction: 'prerequisites' | 'successors' | 'all' = 'all'): NeighborResult[] {
  if (!this.isNodeVisible(nodeId)) {
   return [];
  }

  const results: NeighborResult[] = [];

  if (direction === 'prerequisites' || direction === 'all') {
   const prereqs = this.db
    .prepare(
     `SELECT n.id, n.title, e.relation_type
           FROM knowledge_edges e
           JOIN knowledge_nodes n ON n.id = e.from_node_id
           WHERE e.to_node_id = ?`
    )
    .all(nodeId) as Array<{ id: string; title: string; relation_type: string }>;

   for (const p of prereqs) {
    if (this.isNodeVisible(p.id)) {
     results.push({ nodeId: p.id, title: p.title, relation: p.relation_type });
    }
   }
  }

  if (direction === 'successors' || direction === 'all') {
   const successors = this.db
    .prepare(
     `SELECT n.id, n.title, e.relation_type
           FROM knowledge_edges e
           JOIN knowledge_nodes n ON n.id = e.to_node_id
           WHERE e.from_node_id = ?`
    )
    .all(nodeId) as Array<{ id: string; title: string; relation_type: string }>;

   for (const s of successors) {
    if (this.isNodeVisible(s.id)) {
     results.push({ nodeId: s.id, title: s.title, relation: s.relation_type });
    }
   }
  }

  return results;
 }

 private isNodeVisible(nodeId: string): boolean {
  const activeEvidence = (
   this.db
    .prepare(
     "SELECT count(*) AS total FROM claim_evidence ce " +
      "JOIN claims c ON c.id = ce.claim_id " +
      "WHERE c.knowledge_node_id = ? AND ce.is_active = 1"
    )
    .get(nodeId) as { total: number } | undefined
  )?.total ?? 0;

  if (activeEvidence > 0) {
   return true;
  }

  const activeClaims = (
   this.db
    .prepare(
     "SELECT count(*) AS total FROM claims " +
      "WHERE knowledge_node_id = ? AND status != 'deprecated'"
    )
    .get(nodeId) as { total: number } | undefined
  )?.total ?? 0;

  return activeClaims > 0;
 }
}
