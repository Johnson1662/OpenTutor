import type { Database } from '@opentutor/database';
import type { ClaimService } from '../claims/claim-service.ts';
import type { EvidenceService } from '../claims/evidence-service.ts';

export type DocumentVersionStatus = 'active' | 'superseded' | 'deleted';

export interface DocumentLifecycleResult {
  deactivatedChunkIds: string[];
  affectedClaimIds: string[];
  affectedNodeIds: string[];
}

export class DocumentLifecycleService {
  private readonly db: Database;
  private readonly claimService: ClaimService;
  private readonly evidenceService: EvidenceService;

  constructor(
    db: Database,
    claimService: ClaimService,
    evidenceService: EvidenceService
  ) {
    this.db = db;
    this.claimService = claimService;
    this.evidenceService = evidenceService;
  }

  supersedeDocument(documentId: string, currentVersionId: string): DocumentLifecycleResult {
    // Find all older versions for this document and mark them superseded
    const olderVersions = this.db
      .prepare(
        `SELECT id FROM document_versions WHERE document_id = ? AND id != ? AND status = 'active'`
      )
      .all(documentId, currentVersionId) as Array<{ id: string }>;

    const versionIds = olderVersions.map((v) => v.id);
    if (versionIds.length === 0) {
      return { deactivatedChunkIds: [], affectedClaimIds: [], affectedNodeIds: [] };
    }

    return this.deactivateVersions(versionIds, 'superseded');
  }

  deleteDocument(documentId: string): DocumentLifecycleResult {
    const activeVersions = this.db
      .prepare(
        `SELECT id FROM document_versions WHERE document_id = ? AND status != 'deleted'`
      )
      .all(documentId) as Array<{ id: string }>;

    const versionIds = activeVersions.map((v) => v.id);
    if (versionIds.length === 0) {
      return { deactivatedChunkIds: [], affectedClaimIds: [], affectedNodeIds: [] };
    }

    return this.deactivateVersions(versionIds, 'deleted');
  }

  private deactivateVersions(versionIds: string[], newStatus: DocumentVersionStatus): DocumentLifecycleResult {
    const placeholders = versionIds.map(() => '?').join(',');

    // 1. Update version status
    this.db
      .prepare(
        `UPDATE document_versions SET status = ? WHERE id IN (${placeholders})`
      )
      .run(newStatus, ...versionIds);

    // 2. Find all chunks belonging to these versions
    const chunks = this.db
      .prepare(
        `SELECT id FROM document_chunks WHERE document_version_id IN (${placeholders})`
      )
      .all(...versionIds) as Array<{ id: string }>;

    const deactivatedChunkIds = chunks.map((c) => c.id);
    if (deactivatedChunkIds.length === 0) {
      return { deactivatedChunkIds: [], affectedClaimIds: [], affectedNodeIds: [] };
    }

    const chunkPlaceholders = deactivatedChunkIds.map(() => '?').join(',');

    // 3. Find all claims attached to these chunks
    const claims = this.db
      .prepare(
        `SELECT DISTINCT claim_id FROM claim_evidence WHERE document_chunk_id IN (${chunkPlaceholders})`
      )
      .all(...deactivatedChunkIds) as Array<{ claim_id: string }>;

    const affectedClaimIds = claims.map((c) => c.claim_id);

    // 4. Deactivate chunk evidence
    this.db
      .prepare(
        `UPDATE claim_evidence SET is_active = 0 WHERE document_chunk_id IN (${chunkPlaceholders})`
      )
      .run(...deactivatedChunkIds);

    // 5. Re-evaluate claim statuses
    const affectedNodeIdsSet = new Set<string>();

    for (const claimId of affectedClaimIds) {
      const claim = this.claimService.getClaimById(claimId);
      if (!claim) continue;

      affectedNodeIdsSet.add(claim.knowledgeNodeId);

      // Check if claim has any remaining active evidence
      const activeEvidence = this.evidenceService.getEvidenceForClaim(claimId, true);
      if (activeEvidence.length === 0) {
        // No supporting active evidence remains
        this.claimService.updateClaimStatus(claimId, 'deprecated', 0.0);
      } else {
        // Check if any conflicting active evidence remains
        const hasContradiction = activeEvidence.some((e) => e.relation === 'contradicts');
        if (hasContradiction) {
          this.claimService.updateClaimStatus(claimId, 'conflicting', 0.5);
        } else {
          this.claimService.updateClaimStatus(claimId, 'supported', 1.0);
        }
      }
    }

    return {
      deactivatedChunkIds,
      affectedClaimIds,
      affectedNodeIds: Array.from(affectedNodeIdsSet),
    };
  }
}
