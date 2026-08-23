import type { Database } from '@opentutor/database';
import type { KnowledgeArtifact, ArtifactSection } from './artifact-schema.ts';

export interface ArtifactSupportEvaluation {
 status: 'supported' | 'partially_supported' | 'stale';
 unsupportedSectionIds: string[];
}

export class ArtifactSupportEvaluator {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 evaluate(nodeId: string, artifact: KnowledgeArtifact): ArtifactSupportEvaluation {
  const activeClaimRows = this.db
   .prepare(
    `SELECT DISTINCT c.id FROM claims c
         JOIN claim_evidence ce ON ce.claim_id = c.id
         WHERE c.knowledge_node_id = ? AND c.status != 'deprecated' AND ce.is_active = 1`
   )
   .all(nodeId) as Array<{ id: string }>;

  const activeClaimIds = new Set(activeClaimRows.map((r) => r.id));

  const sections: Array<{ id: string; section?: ArtifactSection }> = [
   { id: 'definition', section: artifact.definition },
   { id: 'intuition', section: artifact.intuition },
   { id: 'mechanism', section: artifact.mechanism },
  ];

  if (artifact.formula) {
   sections.push({ id: 'formula', section: artifact.formula });
  }

  if (Array.isArray(artifact.examples)) {
   artifact.examples.forEach((ex, idx) => {
    sections.push({ id: `examples[${idx}]`, section: ex });
   });
  }

  if (Array.isArray(artifact.misconceptions)) {
   artifact.misconceptions.forEach((m, idx) => {
    sections.push({ id: `misconceptions[${idx}]`, section: m });
   });
  }

  const unsupportedSectionIds: string[] = [];

  for (const { id, section } of sections) {
   if (!section || !Array.isArray(section.claimIds) || section.claimIds.length === 0) {
    unsupportedSectionIds.push(id);
    continue;
   }

   const allClaimsActive = section.claimIds.every((cid) => activeClaimIds.has(cid));
   if (!allClaimsActive) {
    unsupportedSectionIds.push(id);
   }
  }

  const totalSections = sections.length;
  let status: 'supported' | 'partially_supported' | 'stale' = 'supported';

  if (totalSections === 0 || unsupportedSectionIds.length === totalSections) {
   status = 'stale';
  } else if (unsupportedSectionIds.length > 0) {
   status = 'partially_supported';
  } else {
   status = 'supported';
  }

  return {
   status,
   unsupportedSectionIds,
  };
 }
}
