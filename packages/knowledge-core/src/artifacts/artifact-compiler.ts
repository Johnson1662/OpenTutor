import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import type { ClaimService } from '../claims/claim-service.ts';
import type { EvidenceService } from '../claims/evidence-service.ts';
import type { RelationResolver } from '../resolution/relation-resolver.ts';
import { computeSha256 } from '../source/source-hash.ts';
import type { KnowledgeArtifact } from './artifact-schema.ts';
import { FakeArtifactSynthesizer, type ArtifactSynthesizer } from './artifact-synthesizer.ts';

export interface CompiledArtifact {
 artifactId: string;
 nodeId: string;
 version: number;
 content: KnowledgeArtifact;
 isNewVersion: boolean;
}

export class ArtifactCompiler {
 private readonly db: Database;
 private readonly claimService: ClaimService;
 private readonly evidenceService: EvidenceService;
 private readonly relationResolver: RelationResolver;
 private readonly synthesizer: ArtifactSynthesizer;

 constructor(
  db: Database,
  claimService: ClaimService,
  evidenceService: EvidenceService,
  relationResolver: RelationResolver,
  synthesizer: ArtifactSynthesizer = new FakeArtifactSynthesizer()
 ) {
  this.db = db;
  this.claimService = claimService;
  this.evidenceService = evidenceService;
  this.relationResolver = relationResolver;
  this.synthesizer = synthesizer;
 }

 async compile(nodeId: string, title: string): Promise<CompiledArtifact> {
  const claims = this.claimService.getClaimsForNode(nodeId, true);
  const validClaimIds = new Set(claims.map((c) => c.id));
  const edges = this.relationResolver.getEdgesForNode(nodeId);
  const relatedNodeTitles = edges.map((e) => e.toNodeId);

  // 1. Synthesize candidate artifact
  const candidateArtifact = await this.synthesizer.synthesize(
   nodeId,
   title,
   claims,
   relatedNodeTitles
  );

  // 2. Validate section claim IDs against the database
  const validatedArtifact: KnowledgeArtifact = {
   ...candidateArtifact,
   nodeId,
   title,
   definition: {
    text: candidateArtifact.definition.text,
    claimIds: candidateArtifact.definition.claimIds.filter((id) => validClaimIds.has(id)),
   },
   intuition: {
    text: candidateArtifact.intuition.text,
    claimIds: candidateArtifact.intuition.claimIds.filter((id) => validClaimIds.has(id)),
   },
   mechanism: {
    text: candidateArtifact.mechanism.text,
    claimIds: candidateArtifact.mechanism.claimIds.filter((id) => validClaimIds.has(id)),
   },
   formula: candidateArtifact.formula
    ? {
     text: candidateArtifact.formula.text,
     claimIds: candidateArtifact.formula.claimIds.filter((id) => validClaimIds.has(id)),
    }
    : undefined,
   examples: (candidateArtifact.examples || []).map((ex) => ({
    text: ex.text,
    claimIds: ex.claimIds.filter((id) => validClaimIds.has(id)),
   })),
   misconceptions: (candidateArtifact.misconceptions || []).map((m) => ({
    text: m.text,
    claimIds: m.claimIds.filter((id) => validClaimIds.has(id)),
   })),
  };

  // 3. Check against existing latest artifact version
  const latestRow = this.db
   .prepare(
    `SELECT id, version, content_hash, content_json
         FROM knowledge_artifacts
         WHERE knowledge_node_id = ?
         ORDER BY version DESC
         LIMIT 1`
   )
   .get(nodeId) as { id: string; version: number; content_hash: string; content_json: string } | undefined;

  const contentJson = JSON.stringify(validatedArtifact);
  const contentHash = computeSha256(contentJson);

  if (latestRow && latestRow.content_hash === contentHash) {
   return {
    artifactId: latestRow.id,
    nodeId,
    version: latestRow.version,
    content: JSON.parse(latestRow.content_json) as KnowledgeArtifact,
    isNewVersion: false,
   };
  }

  const nextVersion = (latestRow?.version ?? 0) + 1;
  const artifactId = `art-${randomUUID()}`;
  const now = new Date().toISOString();

  this.db
   .prepare(
    `INSERT INTO knowledge_artifacts (id, name, knowledge_node_id, version, content_hash, content_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
   )
   .run(artifactId, title, nodeId, nextVersion, contentHash, contentJson, now, now);

  return {
   artifactId,
   nodeId,
   version: nextVersion,
   content: validatedArtifact,
   isNewVersion: true,
  };
 }

 getLatestArtifact(nodeId: string): KnowledgeArtifact | null {
  const row = this.db
   .prepare(
    `SELECT content_json
         FROM knowledge_artifacts
         WHERE knowledge_node_id = ?
         ORDER BY version DESC
         LIMIT 1`
   )
   .get(nodeId) as { content_json: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.content_json) as KnowledgeArtifact;
 }
}
