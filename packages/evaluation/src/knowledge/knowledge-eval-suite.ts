import { createDatabase, type Database } from '@opentutor/database';
import {
  LivingKnowledgeCompiler,
  ArtifactSupportEvaluator,
  ModelKnowledgeAnalyzer,
  ModelArtifactSynthesizer,
  type KnowledgeAnalyzer,
  type KnowledgeCandidate,
  type CompiledArtifact,
  type ArtifactSynthesizer,
} from '@opentutor/knowledge-core';
import {
  createOpenTutorModelRuntime,
  ModelSelectionService,
  RoleModelResolver,
  PiModelDriver,
  DefaultModelExecutionService,
  ModelPreferencesRepository,
} from '@opentutor/model-runtime';
import type {
  DomainFixtureBundle,
  EvalCase,
  EvalResult,
  EvalSuiteResult,
  HardFailure,
  MetricResult,
  EvalMode,
} from '../core/index.ts';
import {
  createMetric,
  assertNoForbiddenMerges,
  calculateRecall,
  calculatePrecision,
  loadAllDomainBundles,
  ModelSetupRequiredError,
  MODEL_SETUP_REQUIRED,
} from '../core/index.ts';
export class BenchmarkDomainKnowledgeAnalyzer implements KnowledgeAnalyzer {
  private readonly bundle: DomainFixtureBundle;

  constructor(bundle: DomainFixtureBundle) {
    this.bundle = bundle;
  }

  async analyzeChunks(chunks: Array<{ id: string; heading?: string; content: string }>): Promise<KnowledgeCandidate[]> {
    const candidates: KnowledgeCandidate[] = [];

    for (const chunk of chunks) {
      const heading = chunk.heading ?? 'General Concept';
      const matchedEntity = this.bundle.knowledge.entities.find(
        (e) =>
          e.canonicalName.toLowerCase() === heading.toLowerCase() ||
          e.aliases?.some((a) => a.toLowerCase() === heading.toLowerCase()) ||
          heading.toLowerCase().includes(e.canonicalName.toLowerCase())
      );

      const canonicalName = matchedEntity ? matchedEntity.canonicalName : heading;
      const aliases = matchedEntity?.aliases ? [...matchedEntity.aliases] : [heading.toLowerCase()];
      if (!aliases.includes(heading)) aliases.push(heading);

      const sentences = chunk.content
        .split(/(?<=[.!?])\s+|\n\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10);

      const claims = sentences.map((sentence) => ({
        statement: sentence,
        evidenceChunkIds: [chunk.id],
      }));

      const relations: KnowledgeCandidate['relations'] = [];
      const entityId = matchedEntity?.id;
      if (entityId) {
        // In bundle.relations, { from: prereq, to: dependent }.
        // Candidate is the dependent (entityId), so its targetName is the prerequisite (r.from).
        const domainPrereqs = this.bundle.relations.filter((r) => r.to === entityId);
        for (const r of domainPrereqs) {
          const prereqEntity = this.bundle.knowledge.entities.find((e) => e.id === r.from);
          if (prereqEntity) {
            const relType = r.type === 'prerequisite' || r.type === 'part_of' || r.type === 'related'
              ? r.type
              : 'prerequisite';
            relations.push({
              targetName: prereqEntity.canonicalName,
              relation: relType,
            });
          }
        }
      }

      candidates.push({
        canonicalName,
        aliases,
        definition: matchedEntity?.definition ?? sentences[0] ?? heading,
        claims,
        relations,
      });
    }

    return candidates;
  }
}

export interface KnowledgeEvalOptions {
  mode?: EvalMode;
  bundles?: Record<string, DomainFixtureBundle>;
  evalsDir?: string;
  customAnalyzerFactory?: (bundle: DomainFixtureBundle) => KnowledgeAnalyzer;
}

export class KnowledgeEvalSuite {
  readonly mode: EvalMode;
  private readonly bundles: Record<string, DomainFixtureBundle>;
  private readonly customAnalyzerFactory?: (bundle: DomainFixtureBundle) => KnowledgeAnalyzer;

  constructor(options: KnowledgeEvalOptions = {}) {
    this.mode = options.mode ?? 'contract';
    this.bundles = options.bundles ?? loadAllDomainBundles(options.evalsDir);
    this.customAnalyzerFactory = options.customAnalyzerFactory;
  }
  async runSuite(targetDomain?: string): Promise<EvalSuiteResult> {
    const startTime = Date.now();
    const domainKeys = targetDomain && targetDomain !== 'all'
      ? [targetDomain]
      : Object.keys(this.bundles);

    const evalResults: EvalResult[] = [];
    let totalHardFailures = 0;

    for (const domain of domainKeys) {
      const bundle = this.bundles[domain];
      if (!bundle) continue;

      const evalResult = await this.evaluateDomain(bundle);
      evalResults.push(evalResult);
      totalHardFailures += evalResult.hardFailures.length;
    }

    const passedCases = evalResults.filter((r) => r.passed).length;
    const metricSums: Record<string, { sum: number; count: number }> = {};

    for (const r of evalResults) {
      for (const m of r.metrics) {
        if (!metricSums[m.name]) metricSums[m.name] = { sum: 0, count: 0 };
        metricSums[m.name].sum += m.value;
        metricSums[m.name].count += 1;
      }
    }

    const aggregatedMetrics: Record<string, number> = {};
    for (const [name, data] of Object.entries(metricSums)) {
      aggregatedMetrics[name] = data.count > 0 ? Number((data.sum / data.count).toFixed(4)) : 0;
    }

    const passed = totalHardFailures === 0 && passedCases === evalResults.length && evalResults.length > 0;

    return {
      name: 'Knowledge Compiler Evaluation Suite',
      totalCases: evalResults.length,
      passedCases,
      hardFailureCount: totalHardFailures,
      metrics: aggregatedMetrics,
      passed,
      results: evalResults,
      durationMs: Date.now() - startTime,
    };
  }

  async evaluateDomain(bundle: DomainFixtureBundle): Promise<EvalResult> {
    const startTime = Date.now();
    const hardFailures: HardFailure[] = [];
    const metrics: MetricResult[] = [];

    // 1. Spin up fresh in-memory database
    const db = createDatabase(':memory:');
    let analyzer: KnowledgeAnalyzer;
    let synthesizer: ArtifactSynthesizer | undefined;

    if (this.mode === 'production') {
      if (this.customAnalyzerFactory) {
        analyzer = this.customAnalyzerFactory(bundle);
        if (analyzer instanceof BenchmarkDomainKnowledgeAnalyzer || analyzer.constructor.name === 'BenchmarkDomainKnowledgeAnalyzer') {
          throw new Error('PROHIBITED_ADAPTER: BenchmarkDomainKnowledgeAnalyzer is strictly prohibited in production mode.');
        }
      } else {
        const runtime = await createOpenTutorModelRuntime();
        const available = await runtime.getAvailable();
        if (available.length === 0) {
          throw new ModelSetupRequiredError('MODEL_SETUP_REQUIRED: No live AI model credentials or driver available for production knowledge evaluation.');
        }
        const prefsRepo = new ModelPreferencesRepository(db);
        const first = available[0];
        if (first) {
          prefsRepo.setPreferences('eval-user', {
            defaultProviderId: first.provider,
            defaultModelId: first.id,
            thinkingLevel: 'off',
          });
        }
        const selectionService = new ModelSelectionService(runtime, prefsRepo);
        const roleResolver = new RoleModelResolver(selectionService, runtime, prefsRepo);
        const driver = new PiModelDriver(runtime);
        const executionService = new DefaultModelExecutionService(roleResolver, driver);
        analyzer = new ModelKnowledgeAnalyzer(executionService);
        synthesizer = new ModelArtifactSynthesizer(executionService);
      }
    } else {
      analyzer = this.customAnalyzerFactory
        ? this.customAnalyzerFactory(bundle)
        : new BenchmarkDomainKnowledgeAnalyzer(bundle);
    }

    const compiler = new LivingKnowledgeCompiler(db, analyzer, synthesizer);

    // 2. Ingest and compile domain source markdown
    let compilationResult: { compiledArtifacts: CompiledArtifact[] };
    try {
      compilationResult = await compiler.ingestAndCompile({
        id: `source-${bundle.domain}`,
        title: `${bundle.domain} Benchmark Source`,
        content: bundle.sourceText,
      });
    } catch (err: unknown) {
      hardFailures.push({
        rule: 'COMPILER_INGEST_FAILURE',
        message: `Knowledge compilation threw exception: ${err instanceof Error ? err.message : String(err)}`,
        details: err,
      });
      return {
        caseId: `knowledge-eval-${bundle.domain}`,
        domain: bundle.domain,
        hardFailures,
        metrics,
        passed: false,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Query compiled SQLite entities, aliases, claims, relations
    const actualNodes = db
      .prepare(`SELECT id, title, description FROM knowledge_nodes`)
      .all() as Array<{ id: string; title: string; description: string }>;

    const actualAliases = db
      .prepare(`SELECT knowledge_node_id, alias FROM knowledge_node_aliases`)
      .all() as Array<{ knowledge_node_id: string; alias: string }>;

    const actualClaims = db
      .prepare(`SELECT id, knowledge_node_id, statement, status FROM claims`)
      .all() as Array<{ id: string; knowledge_node_id: string; statement: string; status: string }>;

    const actualEvidence = db
      .prepare(`SELECT claim_id, document_chunk_id, is_active FROM claim_evidence`)
      .all() as Array<{ claim_id: string; document_chunk_id: string; is_active: number }>;

    const actualChunks = db
      .prepare(`SELECT id, content FROM document_chunks`)
      .all() as Array<{ id: string; content: string }>;

    const chunkIdSet = new Set(actualChunks.map((c) => c.id));

    // 4. Metric & Validator: Entity Recall & Precision
    const expectedEntityNames = bundle.knowledge.entities.map((e) => e.canonicalName);
    const actualEntityTitles = actualNodes.map((n) => n.title);

    const recall = calculateRecall(actualEntityTitles, expectedEntityNames);
    const precision = calculatePrecision(actualEntityTitles, expectedEntityNames);

    metrics.push(createMetric('entity_recall', recall, { op: 'gte', value: 0.95 }));
    metrics.push(createMetric('entity_precision', precision, { op: 'gte', value: 0.80 }));

    // 5. Metric: Alias Merge Recall
    let totalAliasPairs = 0;
    let successfulAliasPairs = 0;
    for (const group of bundle.aliases) {
      if (group.length < 2) continue;
      const canonical = group[0];
      const resolvedCanonical = compiler.resolver.resolve(canonical);

      for (let i = 1; i < group.length; i++) {
        totalAliasPairs++;
        const resolvedAlias = compiler.resolver.resolve(group[i]);
        if (resolvedCanonical.id === resolvedAlias.id) {
          successfulAliasPairs++;
        }
      }
    }
    const aliasMergeRecall = totalAliasPairs > 0 ? successfulAliasPairs / totalAliasPairs : 1.0;
    metrics.push(createMetric('alias_merge_recall', aliasMergeRecall, { op: 'gte', value: 0.95 }));

    // 6. Hard Validator & Metric: Forbidden Merges
    const mergedClustersMap = new Map<string, Set<string>>();
    for (const row of actualAliases) {
      if (!mergedClustersMap.has(row.knowledge_node_id)) {
        mergedClustersMap.set(row.knowledge_node_id, new Set());
      }
      mergedClustersMap.get(row.knowledge_node_id)!.add(row.alias);
    }
    for (const node of actualNodes) {
      if (!mergedClustersMap.has(node.id)) {
        mergedClustersMap.set(node.id, new Set());
      }
      mergedClustersMap.get(node.id)!.add(node.title);
    }

    const clusterArray = Array.from(mergedClustersMap.values());
    const forbiddenMergeFailures = assertNoForbiddenMerges(clusterArray, bundle.forbiddenMerges);
    hardFailures.push(...forbiddenMergeFailures);

    const wrongMergeRate = bundle.forbiddenMerges.length > 0
      ? forbiddenMergeFailures.length / bundle.forbiddenMerges.length
      : 0;
    metrics.push(createMetric('wrong_merge_rate', wrongMergeRate, { op: 'lte', value: 0.02 }));

    // 7. Hard Validator & Metric: Claim Grounding Rate
    let groundedClaims = 0;
    const activeEvidenceByClaim = new Map<string, Array<{ document_chunk_id: string; is_active: number }>>();
    for (const ev of actualEvidence) {
      if (ev.is_active === 1) {
        if (!activeEvidenceByClaim.has(ev.claim_id)) {
          activeEvidenceByClaim.set(ev.claim_id, []);
        }
        activeEvidenceByClaim.get(ev.claim_id)!.push(ev);
      }
    }

    for (const claim of actualClaims) {
      const evidences = activeEvidenceByClaim.get(claim.id) ?? [];
      if (evidences.length === 0) {
        hardFailures.push({
          rule: 'CLAIM_MISSING_ACTIVE_EVIDENCE',
          message: `Claim '${claim.id}' ("${claim.statement.slice(0, 40)}...") has no active evidence.`,
          details: { claimId: claim.id },
        });
        continue;
      }

      let hasHallucinatedChunk = false;
      for (const ev of evidences) {
        if (!chunkIdSet.has(ev.document_chunk_id)) {
          hasHallucinatedChunk = true;
          hardFailures.push({
            rule: 'CLAIM_HALLUCINATED_EVIDENCE_CHUNK',
            message: `Claim '${claim.id}' references non-existent chunk '${ev.document_chunk_id}'.`,
            details: { claimId: claim.id, chunkId: ev.document_chunk_id },
          });
        }
      }

      if (!hasHallucinatedChunk) {
        groundedClaims++;
      }
    }

    const claimGroundingRate = actualClaims.length > 0 ? groundedClaims / actualClaims.length : 1.0;
    metrics.push(createMetric('claim_grounding_rate', claimGroundingRate, { op: 'gte', value: 1.0 }));

    // 8. Metric: Relation Validity
    const actualRelations = db
      .prepare(`SELECT from_node_id, to_node_id, relation_type FROM knowledge_edges`)
      .all() as Array<{ from_node_id: string; to_node_id: string; relation_type: string }>;

    let validRelations = 0;
    if (bundle.relations.length > 0) {
      for (const expectedRel of bundle.relations) {
        const sourceEntity = bundle.knowledge.entities.find((e) => e.id === expectedRel.from);
        const targetEntity = bundle.knowledge.entities.find((e) => e.id === expectedRel.to);

        if (sourceEntity && targetEntity) {
          const resolvedSource = compiler.resolver.resolve(sourceEntity.canonicalName);
          const resolvedTarget = compiler.resolver.resolve(targetEntity.canonicalName);

          const exists = actualRelations.some(
            (r) =>
              (r.from_node_id === resolvedSource.id && r.to_node_id === resolvedTarget.id) ||
              (r.from_node_id === resolvedTarget.id && r.to_node_id === resolvedSource.id)
          );
          if (exists) {
            validRelations++;
          }
        }
      }
    }
    const relationValidity = bundle.relations.length > 0
      ? validRelations / bundle.relations.length
      : 1.0;
    metrics.push(createMetric('relation_validity', relationValidity, { op: 'gte', value: 0.90 }));

    // 9. Metric: Artifact Support Evaluator
    const artifactEvaluator = new ArtifactSupportEvaluator(db);
    let supportedArtifacts = 0;
    let totalArtifactsEvaluated = 0;

    for (const compiled of compilationResult.compiledArtifacts) {
      totalArtifactsEvaluated++;
      const evalResult = artifactEvaluator.evaluate(compiled.nodeId, compiled.content);
      if (evalResult.status === 'supported') {
        supportedArtifacts++;
      } else if (evalResult.status === 'stale') {
        hardFailures.push({
          rule: 'STALE_COMPILED_ARTIFACT',
          message: `Compiled artifact for node '${compiled.nodeId}' evaluated to STALE.`,
          details: { nodeId: compiled.nodeId, unsupported: evalResult.unsupportedSectionIds },
        });
      }
    }

    const artifactSupportRate = totalArtifactsEvaluated > 0
      ? supportedArtifacts / totalArtifactsEvaluated
      : 1.0;
    metrics.push(createMetric('artifact_support_rate', artifactSupportRate, { op: 'gte', value: 0.90 }));

    const allMetricsPassed = metrics.every((m) => m.passed);
    const passed = hardFailures.length === 0 && allMetricsPassed;

    return {
      caseId: `knowledge-eval-${bundle.domain}`,
      domain: bundle.domain,
      hardFailures,
      metrics,
      passed,
      durationMs: Date.now() - startTime,
    };
  }
}
