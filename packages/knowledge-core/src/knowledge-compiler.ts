import type { Database } from '@opentutor/database';
import { IngestionService, type IngestDocumentInput, type IngestedDocument } from './source/ingestion-service.ts';
import { FakeKnowledgeAnalyzer } from './analysis/fake-analyzer.ts';
import type { KnowledgeAnalyzer } from './analysis/knowledge-analyzer.ts';
import { EntityResolver } from './resolution/entity-resolver.ts';
import { RelationResolver } from './resolution/relation-resolver.ts';
import { ClaimService } from './claims/claim-service.ts';
import { EvidenceService } from './claims/evidence-service.ts';
import { ClaimReconciler } from './claims/claim-reconciler.ts';
import { DocumentLifecycleService } from './source/document-lifecycle.ts';
import { ArtifactCompiler, type CompiledArtifact } from './artifacts/artifact-compiler.ts';
import { FakeArtifactSynthesizer, type ArtifactSynthesizer } from './artifacts/artifact-synthesizer.ts';
import { SearchService } from './retrieval/search-service.ts';

export class LivingKnowledgeCompiler {
  readonly db: Database;
  readonly ingestion: IngestionService;
  readonly analyzer: KnowledgeAnalyzer;
  readonly resolver: EntityResolver;
  readonly relations: RelationResolver;
  readonly claims: ClaimService;
  readonly evidence: EvidenceService;
  readonly reconciler: ClaimReconciler;
  readonly lifecycle: DocumentLifecycleService;
  readonly artifacts: ArtifactCompiler;
  readonly retrieval: SearchService;

  constructor(
    db: Database,
    analyzer?: KnowledgeAnalyzer,
    synthesizer?: ArtifactSynthesizer
  ) {
    this.db = db;
    this.ingestion = new IngestionService(db);
    this.analyzer = analyzer ?? new FakeKnowledgeAnalyzer();
    this.resolver = new EntityResolver(db);
    this.relations = new RelationResolver(db);
    this.claims = new ClaimService(db);
    this.evidence = new EvidenceService(db);
    this.reconciler = new ClaimReconciler(this.claims, this.evidence);
    this.lifecycle = new DocumentLifecycleService(db, this.claims, this.evidence);
    this.artifacts = new ArtifactCompiler(
      db,
      this.claims,
      this.evidence,
      this.relations,
      synthesizer ?? new FakeArtifactSynthesizer()
    );
    this.retrieval = new SearchService(db, this.artifacts);
  }

  async ingestAndCompile(input: IngestDocumentInput): Promise<{
    document: IngestedDocument;
    compiledArtifacts: CompiledArtifact[];
  }> {
    const document = this.ingestion.ingest(input);

    // Handle document superseding if a previous version existed
    if (document.isNewVersion) {
      this.lifecycle.supersedeDocument(document.id, document.documentVersionId);
    }

    const candidates = await this.analyzer.analyzeChunks(document.chunks);
    const compiledArtifacts: CompiledArtifact[] = [];

    for (const candidate of candidates) {
      const entity = this.resolver.resolve(
        candidate.canonicalName,
        candidate.definition,
        candidate.aliases
      );

      // Reconcile claims using ClaimReconciler
      this.reconciler.reconcileClaims(entity.id, candidate.claims);

      // Add conceptual relations
      for (const rel of candidate.relations) {
        const targetEntity = this.resolver.resolve(rel.targetName);
        const relType =
          rel.relation === 'prerequisite' || rel.relation === 'part_of' || rel.relation === 'related'
            ? rel.relation
            : 'related';
        this.relations.addRelation(targetEntity.id, entity.id, relType);
      }

      const artifact = await this.artifacts.compile(entity.id, entity.title);
      compiledArtifacts.push(artifact);
    }

    return {
      document,
      compiledArtifacts,
    };
  }

  // Backward-compatible ingest alias
  ingest(input: IngestDocumentInput) {
    return this.ingestion.ingest(input);
  }

  // Backward-compatible search alias
  search(query: string, limit = 10) {
    return this.retrieval.knowledgeSearch(query, limit);
  }
}

// Backward compatibility alias for earlier tests
export const KnowledgeCompiler = LivingKnowledgeCompiler;
export const KnowledgeRetriever = SearchService;
