import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import type { ClaimService } from '../claims/claim-service.ts';
import type { EvidenceService } from '../claims/evidence-service.ts';
import type { RelationResolver } from '../resolution/relation-resolver.ts';
import { computeSha256 } from '../source/source-hash.ts';

export interface KnowledgeArtifactContent {
 nodeId: string;
 title: string;
 definition: string;
 intuition: string;
 mechanism: string;
 prerequisites: string[];
 formula?: string;
 examples: string[];
 misconceptions: string[];
 related: string[];
 sources: string[];
}

export interface CompiledArtifact {
 artifactId: string;
 nodeId: string;
 version: number;
 content: KnowledgeArtifactContent;
 isNewVersion: boolean;
}

export class ArtifactCompiler {
 private readonly db: Database;
 private readonly claimService: ClaimService;
 private readonly evidenceService: EvidenceService;
 private readonly relationResolver: RelationResolver;

 constructor(
  db: Database,
  claimService: ClaimService,
  evidenceService: EvidenceService,
  relationResolver: RelationResolver
 ) {
  this.db = db;
  this.claimService = claimService;
  this.evidenceService = evidenceService;
  this.relationResolver = relationResolver;
 }

 compile(nodeId: string, title: string): CompiledArtifact {
  const claims = this.claimService.getClaimsForNode(nodeId);
  const evidence = this.evidenceService.getEvidenceForNode(nodeId);
  const prerequisites = this.relationResolver.getPrerequisites(nodeId);

  const definition = claims[0]?.statement ?? `Core foundational concept for ${title}.`;
  const intuition = claims[1]?.statement ?? `Intuitive mental model for ${title}.`;
  const mechanism = claims.slice(2).map((c) => c.statement).join(' ') || `Operational mechanics and behavior of ${title}.`;

  const sources = Array.from(new Set(evidence.map((e) => e.documentChunkId)));

  const content: KnowledgeArtifactContent = {
   nodeId,
   title,
   definition,
   intuition,
   mechanism,
   prerequisites,
   examples: [`Canonical application of ${title}`],
   misconceptions: [`Common point of confusion regarding ${title}`],
   related: [],
   sources,
  };

  const serializedContent = JSON.stringify(content);
  const artifactId = `artifact-${nodeId}`;

  const existingArtifact = this.db
   .prepare('SELECT id FROM knowledge_artifacts WHERE id = ?')
   .get(artifactId) as { id: string } | undefined;

  if (!existingArtifact) {
   this.db
    .prepare(
     `INSERT INTO knowledge_artifacts (id, name, artifact_type, created_at, updated_at)
           VALUES (?, ?, 'knowledge', datetime('now'), datetime('now'))`
    )
    .run(artifactId, title);
  }

  const latestVersion = this.db
   .prepare(
    `SELECT version, content
         FROM knowledge_artifact_versions
         WHERE artifact_id = ?
         ORDER BY version DESC
         LIMIT 1`
   )
   .get(artifactId) as { version: number; content: string } | undefined;

  if (latestVersion && computeSha256(latestVersion.content) === computeSha256(serializedContent)) {
   return {
    artifactId,
    nodeId,
    version: latestVersion.version,
    content,
    isNewVersion: false,
   };
  }

  const newVersion = (latestVersion?.version ?? 0) + 1;
  const versionId = randomUUID();

  this.db.transaction(() => {
   this.db
    .prepare(
     `INSERT INTO knowledge_artifact_versions (id, artifact_id, version, content, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .run(versionId, artifactId, newVersion, serializedContent);

   this.db
    .prepare('UPDATE knowledge_artifacts SET updated_at = datetime(\'now\') WHERE id = ?')
    .run(artifactId);

   // Sync into FTS5 virtual table
   const claimsText = claims.map((c) => c.statement).join(' ');
   const contentText = `${definition} ${intuition} ${mechanism}`;

   this.db
    .prepare('DELETE FROM knowledge_fts WHERE node_id = ?')
    .run(nodeId);

   this.db
    .prepare(
     `INSERT INTO knowledge_fts (node_id, title, aliases, claims, content)
           VALUES (?, ?, ?, ?, ?)`
    )
    .run(nodeId, title, title.toLowerCase(), claimsText, contentText);
  })();

  return {
   artifactId,
   nodeId,
   version: newVersion,
   content,
   isNewVersion: true,
  };
 }

 getLatestArtifact(nodeId: string): KnowledgeArtifactContent | null {
  const artifactId = `artifact-${nodeId}`;
  const row = this.db
   .prepare(
    `SELECT content
         FROM knowledge_artifact_versions
         WHERE artifact_id = ?
         ORDER BY version DESC
         LIMIT 1`
   )
   .get(artifactId) as { content: string } | undefined;

  if (!row) return null;
  try {
   return JSON.parse(row.content) as KnowledgeArtifactContent;
  } catch {
   return null;
  }
 }
}
