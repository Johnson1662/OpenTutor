import { createDatabase, type Database } from '@opentutor/database';
import { EntityResolver, LivingKnowledgeCompiler, ModelKnowledgeAnalyzer, type KnowledgeAnalyzer } from '@opentutor/knowledge-core';
import {
  CourseCompiler,
  ModelGoalAnalyzer,
  type CourseGoalAnalysis,
  type CourseGraph,
  type GoalAnalyzer,
} from '@opentutor/course-core';
import {
  createOpenTutorModelRuntime,
  ModelSelectionService,
  RoleModelResolver,
  PiModelDriver,
  DefaultModelExecutionService,
  ModelPreferencesRepository,
} from '@opentutor/model-runtime';
import type { LearningPathNode } from '@opentutor/protocol';
import type {
  CourseCaseFixture,
  DomainFixtureBundle,
  EvalResult,
  EvalSuiteResult,
  HardFailure,
  MetricResult,
  EvalMode,
} from '../core/index.ts';
import {
  assertAcyclic,
  assertPrerequisiteClosure,
  calculateTopologicalValidity,
  createMetric,
  loadAllDomainBundles,
  ModelSetupRequiredError,
  MODEL_SETUP_REQUIRED,
} from '../core/index.ts';
import { BenchmarkDomainKnowledgeAnalyzer } from '../knowledge/knowledge-eval-suite.ts';
export class BenchmarkGoalAnalyzer implements GoalAnalyzer {
  private readonly bundle: DomainFixtureBundle;

  constructor(bundle: DomainFixtureBundle) {
    this.bundle = bundle;
  }

  async analyzeGoal(goal: string): Promise<CourseGoalAnalysis> {
    const matchedCase = this.bundle.courseCases.find(
      (c) => c.goal.toLowerCase() === goal.toLowerCase() || goal.toLowerCase().includes(c.goal.toLowerCase())
    );

    const targetConcepts: string[] = [];

    if (matchedCase) {
      for (const targetId of matchedCase.targetNodes) {
        const entity = this.bundle.knowledge.entities.find(
          (e) => e.id === targetId || e.canonicalName.toLowerCase() === targetId.toLowerCase()
        );
        if (entity) {
          targetConcepts.push(entity.canonicalName);
        } else {
          targetConcepts.push(targetId);
        }
      }
    } else {
      const lower = goal.toLowerCase();
      for (const e of this.bundle.knowledge.entities) {
        if (lower.includes(e.canonicalName.toLowerCase()) || lower.includes(e.id.toLowerCase())) {
          targetConcepts.push(e.canonicalName);
        }
      }
    }

    if (targetConcepts.length === 0 && this.bundle.knowledge.entities.length > 0) {
      targetConcepts.push(this.bundle.knowledge.entities[0].canonicalName);
    }

    return {
      targetConcepts,
      depth: 'intermediate',
    };
  }
}

export interface CourseEvalOptions {
  mode?: EvalMode;
  bundles?: Record<string, DomainFixtureBundle>;
  evalsDir?: string;
}

export class CourseEvalSuite {
  readonly mode: EvalMode;
  private readonly bundles: Record<string, DomainFixtureBundle>;

  constructor(options: CourseEvalOptions = {}) {
    this.mode = options.mode ?? 'contract';
    this.bundles = options.bundles ?? loadAllDomainBundles(options.evalsDir);
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
      if (!bundle || bundle.courseCases.length === 0) continue;

      for (const courseCase of bundle.courseCases) {
        const result = await this.evaluateCourseCase(bundle, courseCase);
        evalResults.push(result);
        totalHardFailures += result.hardFailures.length;
      }
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
      name: 'Course Compiler Evaluation Suite',
      totalCases: evalResults.length,
      passedCases,
      hardFailureCount: totalHardFailures,
      metrics: aggregatedMetrics,
      passed,
      results: evalResults,
      durationMs: Date.now() - startTime,
    };
  }

  async evaluateCourseCase(
    bundle: DomainFixtureBundle,
    courseCase: CourseCaseFixture
  ): Promise<EvalResult> {
    const startTime = Date.now();
    const hardFailures: HardFailure[] = [];
    const metrics: MetricResult[] = [];

    // 1. Initialize SQLite database and populate compiled knowledge graph
    const db = createDatabase(':memory:');
    let knowledgeAnalyzer: KnowledgeAnalyzer;
    let goalAnalyzer: GoalAnalyzer;

    if (this.mode === 'production') {
      const runtime = await createOpenTutorModelRuntime();
      const available = await runtime.getAvailable();
      if (available.length === 0) {
        throw new ModelSetupRequiredError('MODEL_SETUP_REQUIRED: No live AI model credentials or driver available for production course evaluation.');
      }
      const prefsRepo = new ModelPreferencesRepository(db);
      const preferredProvider = process.env.OPENTUTOR_DEFAULT_PROVIDER;
      const preferredModel = process.env.OPENTUTOR_DEFAULT_MODEL;
      const first = available.find((model) =>
        (!preferredProvider || model.provider === preferredProvider) &&
        (!preferredModel || model.id === preferredModel)
      ) ?? available[0];
      if (first) {
        prefsRepo.setPreferences('default-user', {
          defaultProviderId: first.provider,
          defaultModelId: first.id,
          thinkingLevel: 'off',
        });
      }
      const selectionService = new ModelSelectionService(runtime, prefsRepo);
      const roleResolver = new RoleModelResolver(selectionService, runtime, prefsRepo);
      const driver = new PiModelDriver(runtime);
      const executionService = new DefaultModelExecutionService(roleResolver, driver);
      knowledgeAnalyzer = new ModelKnowledgeAnalyzer(executionService);
      goalAnalyzer = new ModelGoalAnalyzer(executionService);
    } else {
      knowledgeAnalyzer = new BenchmarkDomainKnowledgeAnalyzer(bundle);
      goalAnalyzer = new BenchmarkGoalAnalyzer(bundle);
    }

    const knowledgeCompiler = new LivingKnowledgeCompiler(db, knowledgeAnalyzer);

    await knowledgeCompiler.ingestAndCompile({
      id: `source-${bundle.domain}`,
      title: `${bundle.domain} Source`,
      content: bundle.sourceText,
    });

    const entityResolver = new EntityResolver(db);
    const courseCompiler = new CourseCompiler(db, goalAnalyzer);
    // 2. Compile course graph from goal
    let courseResult: {
      courseGraph: CourseGraph;
      initialPath: LearningPathNode[];
      goalAnalysis: CourseGoalAnalysis;
    };
    try {
      courseResult = await courseCompiler.compileCourse({
        courseId: `course-${courseCase.id}`,
        title: `Mastering ${courseCase.id}`,
        learningGoal: courseCase.goal,
      });
    } catch (err: unknown) {
      hardFailures.push({
        rule: 'COURSE_COMPILATION_ERROR',
        message: `CourseCompiler failed on case '${courseCase.id}': ${err instanceof Error ? err.message : String(err)}`,
        details: err,
      });
      return {
        caseId: courseCase.id,
        domain: bundle.domain,
        hardFailures,
        metrics,
        passed: false,
        durationMs: Date.now() - startTime,
      };
    }

    const { courseGraph, initialPath } = courseResult;
    const includedNodeIds = new Set(courseGraph.nodes.map((n) => n.knowledgeNodeId));

    // Map entity IDs from bundle to resolved node IDs in DB
    const idToResolvedMap: Record<string, string> = {};
    for (const entity of bundle.knowledge.entities) {
      const resolved = entityResolver.resolve(entity.canonicalName);
      idToResolvedMap[entity.id] = resolved.id;
      idToResolvedMap[entity.canonicalName] = resolved.id;
      idToResolvedMap[entity.canonicalName.toLowerCase()] = resolved.id;
    }

    // 3. Metric & Validator: Target Concept Coverage (>= 95%)
    let matchedTargets = 0;
    for (const target of courseCase.targetNodes) {
      const resolvedId = idToResolvedMap[target] ?? entityResolver.resolve(target).id;
      if (includedNodeIds.has(resolvedId)) {
        matchedTargets++;
      } else {
        hardFailures.push({
          rule: 'TARGET_CONCEPT_MISSING',
          message: `Target concept '${target}' (resolved: '${resolvedId}') was not included in course graph.`,
          details: { target, resolvedId },
        });
      }
    }
    const targetCoverage = courseCase.targetNodes.length > 0
      ? matchedTargets / courseCase.targetNodes.length
      : 1.0;
    metrics.push(createMetric('target_concept_coverage', targetCoverage, { op: 'gte', value: 0.95 }));

    // 4. Metric & Validator: Prerequisite Closure (100% closure)
    let matchedPrereqs = 0;
    for (const prereq of courseCase.expectedPrerequisites) {
      const resolvedId = idToResolvedMap[prereq] ?? entityResolver.resolve(prereq).id;
      if (includedNodeIds.has(resolvedId)) {
        matchedPrereqs++;
      } else {
        hardFailures.push({
          rule: 'PREREQUISITE_MISSING_FROM_CLOSURE',
          message: `Expected prerequisite '${prereq}' (resolved: '${resolvedId}') missing from course graph for goal '${courseCase.goal}'.`,
          details: { prereq, resolvedId, goal: courseCase.goal },
        });
      }
    }
    const prereqClosureRate = courseCase.expectedPrerequisites.length > 0
      ? matchedPrereqs / courseCase.expectedPrerequisites.length
      : 1.0;
    metrics.push(createMetric('prerequisite_closure_rate', prereqClosureRate, { op: 'gte', value: 1.0 }));

    // Check DB-level prerequisite closure for all included nodes
    const allDbPrereqs = db
      .prepare(`SELECT from_node_id, to_node_id FROM knowledge_edges WHERE relation_type = 'prerequisite'`)
      .all() as Array<{ from_node_id: string; to_node_id: string }>;

    const prereqMap: Record<string, string[]> = {};
    for (const edge of allDbPrereqs) {
      if (!prereqMap[edge.to_node_id]) prereqMap[edge.to_node_id] = [];
      prereqMap[edge.to_node_id].push(edge.from_node_id);
    }
    const closureFailures = assertPrerequisiteClosure(includedNodeIds, prereqMap);
    hardFailures.push(...closureFailures);

    // 5. Metric & Validator: Topological Ordering Validity
    const orderedNodeIds = initialPath.map((p) => p.knowledgeNodeId);
    const dependencyEdges = courseGraph.edges.map((e) => ({
      from: e.fromNodeId,
      to: e.toNodeId,
    }));

    const topologicalValidity = calculateTopologicalValidity(orderedNodeIds, dependencyEdges);
    metrics.push(createMetric('topological_ordering_validity', topologicalValidity, { op: 'gte', value: 1.0 }));

    if (topologicalValidity < 1.0) {
      hardFailures.push({
        rule: 'TOPOLOGICAL_ORDER_VIOLATION',
        message: `Course initialPath is not in valid topological order according to prerequisite edges.`,
        details: { orderedNodeIds, edges: dependencyEdges },
      });
    }

    // 6. Hard Validator & Metric: Forbidden Nodes
    let forbiddenFound = 0;
    for (const forbidden of courseCase.forbiddenNodes ?? []) {
      const resolvedId = idToResolvedMap[forbidden] ?? entityResolver.resolve(forbidden).id;
      if (includedNodeIds.has(resolvedId)) {
        forbiddenFound++;
        hardFailures.push({
          rule: 'FORBIDDEN_NODE_IN_COURSE_GRAPH',
          message: `Forbidden node '${forbidden}' (resolved: '${resolvedId}') was unexpectedly included in course graph.`,
          details: { forbidden, resolvedId },
        });
      }
    }
    const forbiddenNodeRate = (courseCase.forbiddenNodes?.length ?? 0) > 0
      ? forbiddenFound / courseCase.forbiddenNodes!.length
      : 0.0;
    metrics.push(createMetric('forbidden_node_rate', forbiddenNodeRate, { op: 'lte', value: 0.0 }));

    // 7. Hard Validator & Metric: Graph Cycle Count (must be 0)
    const cycleFailures = assertAcyclic(Array.from(includedNodeIds), dependencyEdges);
    hardFailures.push(...cycleFailures);
    const cycleCount = cycleFailures.length;
    metrics.push(createMetric('graph_cycle_count', cycleCount === 0 ? 1.0 : 0.0, { op: 'gte', value: 1.0 }, { cycleCount }));

    const allMetricsPassed = metrics.every((m) => m.passed);
    const passed = hardFailures.length === 0 && allMetricsPassed;

    return {
      caseId: courseCase.id,
      domain: bundle.domain,
      hardFailures,
      metrics,
      passed,
      durationMs: Date.now() - startTime,
    };
  }
}
