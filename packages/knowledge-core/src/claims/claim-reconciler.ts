import type { ClaimService, Claim } from './claim-service.ts';
import type { EvidenceService } from './evidence-service.ts';
import { ClaimComparator } from './claim-comparator.ts';
import type { ClaimCandidate } from '../analysis/knowledge-candidate-schema.ts';

export class ClaimReconciler {
  private readonly claimService: ClaimService;
  private readonly evidenceService: EvidenceService;
  private readonly comparator: ClaimComparator;

  constructor(
    claimService: ClaimService,
    evidenceService: EvidenceService,
    comparator: ClaimComparator = new ClaimComparator()
  ) {
    this.claimService = claimService;
    this.evidenceService = evidenceService;
    this.comparator = comparator;
  }

  reconcileClaims(knowledgeNodeId: string, candidates: ClaimCandidate[]): Claim[] {
    const existingClaims = this.claimService.getClaimsForNode(knowledgeNodeId);
    const resultClaims: Claim[] = [];

    for (const candidate of candidates) {
      const comparison = this.comparator.compare(candidate.statement, existingClaims);

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
