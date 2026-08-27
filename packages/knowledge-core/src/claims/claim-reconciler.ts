import type { ClaimService, Claim } from './claim-service.ts';
import type { EvidenceService } from './evidence-service.ts';
import { normalizeText } from '../source/source-hash.ts';
import type { ClaimCandidate } from '../analysis/knowledge-candidate-schema.ts';

type ClaimComparisonRelation =
  | 'EXACT_DUPLICATE'
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'QUALIFIES'
  | 'NEW';

interface ClaimComparisonResult {
  relation: ClaimComparisonRelation;
  confidence: number;
  existingClaimId?: string;
  explanation?: string;
}

function compareClaims(
  newStatement: string,
  existingClaims: Array<{ id: string; statement: string; normalizedStatement: string }>
): ClaimComparisonResult {
  const newNorm = normalizeText(newStatement);

  for (const existing of existingClaims) {
    if (existing.normalizedStatement === newNorm) {
      return {
        relation: 'EXACT_DUPLICATE',
        confidence: 1.0,
        existingClaimId: existing.id,
      };
    }

    // Check for direct negation/contradiction heuristics
    const existingNorm = existing.normalizedStatement;
    const hasContradiction =
      (newNorm.includes(' not ') && !existingNorm.includes(' not ') && overlap(newNorm.replace(' not ', ' '), existingNorm) >= 0.4) ||
      (existingNorm.includes(' not ') && !newNorm.includes(' not ') && overlap(existingNorm.replace(' not ', ' '), newNorm) >= 0.4) ||
      (newNorm.includes('decreases') && existingNorm.includes('improves') && overlap(newNorm, existingNorm) >= 0.4) ||
      (newNorm.includes('improves') && existingNorm.includes('decreases') && overlap(newNorm, existingNorm) >= 0.4);

    if (hasContradiction) {
      return {
        relation: 'CONTRADICTS',
        confidence: 0.9,
        existingClaimId: existing.id,
        explanation: `Contradicting statements detected between '${newStatement}' and '${existing.statement}'`,
      };
    }

    // Check for qualification / conditional
    if (
      (newNorm.startsWith(existingNorm) && newNorm.length > existingNorm.length) ||
      (newNorm.includes('only when') || newNorm.includes('if and only if') || newNorm.includes('unless'))
    ) {
      if (overlap(newNorm, existingNorm) > 0.6) {
        return {
          relation: 'QUALIFIES',
          confidence: 0.85,
          existingClaimId: existing.id,
        };
      }
    }
  }

  return {
    relation: 'NEW',
    confidence: 1.0,
  };
}

function overlap(a: string, b: string): number {
  const wordsA = new Set(a.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  return (2 * intersection) / (wordsA.size + wordsB.size);
}

export class ClaimReconciler {
  private readonly claimService: ClaimService;
  private readonly evidenceService: EvidenceService;

  constructor(
    claimService: ClaimService,
    evidenceService: EvidenceService
  ) {
    this.claimService = claimService;
    this.evidenceService = evidenceService;
  }

  reconcileClaims(knowledgeNodeId: string, candidates: ClaimCandidate[]): Claim[] {
    const existingClaims = this.claimService.getClaimsForNode(knowledgeNodeId);
    const resultClaims: Claim[] = [];

    for (const candidate of candidates) {
      const comparison = compareClaims(candidate.statement, existingClaims);

      if (comparison.relation === 'EXACT_DUPLICATE' && comparison.existingClaimId) {
        const existing = this.claimService.getClaimById(comparison.existingClaimId)!;
        for (const chunkId of candidate.evidenceChunkIds) {
          this.evidenceService.linkEvidence(existing.id, chunkId, 'supports', 1.0, true);
        }
        resultClaims.push(existing);
      } else if (comparison.relation === 'CONTRADICTS' && comparison.existingClaimId) {
        // Mark existing claim as conflicting
        this.claimService.updateClaimStatus(comparison.existingClaimId, 'conflicting', 0.5);

        // Record new claim as conflicting
        const newClaim = this.claimService.recordClaim(
          knowledgeNodeId,
          candidate.statement,
          'conflicting',
          0.5
        );
        for (const chunkId of candidate.evidenceChunkIds) {
          this.evidenceService.linkEvidence(newClaim.id, chunkId, 'contradicts', 0.9, true);
        }
        resultClaims.push(newClaim);
      } else if (comparison.relation === 'QUALIFIES') {
        const newClaim = this.claimService.recordClaim(
          knowledgeNodeId,
          candidate.statement,
          'supported',
          0.9
        );
        for (const chunkId of candidate.evidenceChunkIds) {
          this.evidenceService.linkEvidence(newClaim.id, chunkId, 'qualifies', 0.85, true);
        }
        resultClaims.push(newClaim);
      } else {
        // Brand new claim
        const newClaim = this.claimService.recordClaim(
          knowledgeNodeId,
          candidate.statement,
          'supported',
          1.0
        );
        for (const chunkId of candidate.evidenceChunkIds) {
          this.evidenceService.linkEvidence(newClaim.id, chunkId, 'supports', 1.0, true);
        }
        resultClaims.push(newClaim);
      }
    }

    return resultClaims;
  }
}
