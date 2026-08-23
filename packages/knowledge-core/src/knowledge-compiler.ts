import type { Database } from '@opentutor/database';
import { IngestionService, type IngestDocumentInput, type IngestedDocument } from './source/ingestion-service.ts';
import { FakeKnowledgeAnalyzer } from './analysis/fake-analyzer.ts';
import type { KnowledgeAnalyzer } from './analysis/knowledge-analyzer.ts';
import { EntityResolver } from './resolution/entity-resolver.ts';
import { RelationResolver } from './resolution/relation-resolver.ts';
import { ClaimService } from './claims/claim-service.ts';
import { EvidenceService } from './claims/evidence-service.ts';
import { ArtifactCompiler, type CompiledArtifact } from './artifacts/artifact-compiler.ts';
import { SearchService } from './retrieval/search-service.ts';

export class LivingKnowledgeCompiler {
  readonly db: Database;
  readonly ingestion: IngestionService;
  readonly analyzer: KnowledgeAnalyzer;
  readonly resolver: EntityResolver;
  readonly relations: RelationResolver;
  readonly claims: ClaimService;
  readonly evidence: EvidenceService;
  readonly artifacts: ArtifactCompiler;
  readonly retrieval: SearchService;

  constructor(db: Database, analyzer?: KnowledgeAnalyzer) {
    this.db = db;
    this.ingestion = new IngestionService(db);
    this.analyzer = analyzer ?? new FakeKnowledgeAnalyzer();
    this.resolver = new EntityResolver(db);
    this.relations = new RelationResolver(db);
    this.claims = new ClaimService(db);
    this.evidence = new EvidenceService(db);
    this.artifacts = new ArtifactCompiler(db, this.claims, this.evidence, this.relations);
    this.retrieval = new SearchService(db, this.artifacts);
  }

  async ingestAndCompile(input: IngestDocumentInput): Promise<{
    document: IngestedDocument;
    compiledArtifacts: CompiledArtifact[];
  }> {
    const document = this.ingestion.ingest(input);
    const candidates = await this.analyzer.analyzeChunks(document.chunks);
    const compiledArtifacts: CompiledArtifact[] = [];

    for (const candidate of candidates) {
      const entity = this.resolver.resolve(candidate.canonicalName, candidate.definition);
      for (const alias of candidate.aliases) {
        this.resolver.addAlias(entity.id, alias);
      }

      for (const claimCand of candidate.claims) {
        const claim = this.claims.recordClaim(entity.id, claimCand.statement);
        for (const chunkId of claimCand.sourceChunkIds) {
          this.evidence.linkEvidence(claim.id, chunkId, claimCand.statement);
        }
      }

      for (const rel of candidate.relations) {
        const targetEntity = this.resolver.resolve(rel.targetName);
        this.relations.addRelation(targetEntity.id, entity.id, rel.type);
      }

      const artifact = this.artifacts.compile(entity.id, entity.title);
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
