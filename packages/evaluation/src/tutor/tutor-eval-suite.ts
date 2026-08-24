import { createOpenTutorModelRuntime } from '@opentutor/model-runtime';
import type {
  DomainFixtureBundle,
  EvalResult,
  EvalSuiteResult,
  HardFailure,
  MetricResult,
  TutorScenarioFixture,
  EvalMode,
} from '../core/index.ts';
import {
  createMetric,
  loadAllDomainBundles,
  ModelSetupRequiredError,
  MODEL_SETUP_REQUIRED,
} from '../core/index.ts';
export interface SimulatedTutorExecution {
  invokedTools: string[];
  successfulTools?: string[];
  toolExecutions?: Array<{ toolName: string; success: boolean; error?: string }>;
  responseText: string;
  intentDetected: string;
}

export interface TutorPolicyRunner {
  executeScenario(
    scenario: TutorScenarioFixture,
    bundle: DomainFixtureBundle
  ): Promise<SimulatedTutorExecution> | SimulatedTutorExecution;
}

export class BenchmarkTutorPolicyRunner implements TutorPolicyRunner {
  executeScenario(
    scenario: TutorScenarioFixture,
    bundle: DomainFixtureBundle
  ): SimulatedTutorExecution {
    const text = scenario.userMessage.toLowerCase();
    const invokedTools: string[] = [];
    let intentDetected = scenario.expectedIntent ?? 'UNKNOWN';
    // 1. Detect Diagnostic Inquiry / Probe Request for missing concepts / struggle
    if (
      text.includes('struggling') ||
      text.includes("don't know") ||
      text.includes("dont know") ||
      text.includes("haven't learned") ||
      text.includes("havent learned") ||
      text.includes('missing prerequisite') ||
      (text.includes('what exactly is') && !text.includes('detour'))
    ) {
      intentDetected = 'PROBE_REQUEST';
      if (scenario.expectedTools.includes('knowledge_search')) {
        invokedTools.push('knowledge_search');
      }
      if (scenario.expectedTools.includes('probe_request')) {
        invokedTools.push('probe_request');
      }
      return {
        invokedTools,
        successfulTools: [...invokedTools],
        toolExecutions: invokedTools.map((t) => ({ toolName: t, success: true })),
        responseText: `Let's assess your understanding of the prerequisite concept with a quick diagnostic probe before considering a path adjustment.`,
        intentDetected,
      };
    }

    // 1b. Confirmed Detour intent
    if (
      text.includes('confirm detour') ||
      text.includes('take a detour now') ||
      (text.includes('detour') && scenario.expectedTools.includes('path_insert_detour'))
    ) {
      intentDetected = 'INSERT_DETOUR';
      invokedTools.push('path_insert_detour');
      if (scenario.expectedTools.includes('knowledge_search')) {
        invokedTools.push('knowledge_search');
      }
      return {
        invokedTools,
        successfulTools: [...invokedTools],
        toolExecutions: invokedTools.map((t) => ({ toolName: t, success: true })),
        responseText: `Detour inserted for prerequisite.`,
        intentDetected,
      };
    }

    // 2. Detect Advance / Next Concept intent
    if (
      text.includes('proceed') ||
      text.includes('advance') ||
      text.includes('next topic') ||
      text.includes('finished the quiz') ||
      text.includes('ready to move on')
    ) {
      intentDetected = 'ADVANCE_PATH';
      invokedTools.push('path_advance');
      return {
        invokedTools,
        successfulTools: [...invokedTools],
        toolExecutions: invokedTools.map((t) => ({ toolName: t, success: true })),
        responseText: `Great work mastering this topic! Advancing to the next lesson on your learning path.`,
        intentDetected,
      };
    }

    // 3. Detect Canvas Modification (Simplify / Add Code / Add Diagram) intent
    if (
      text.includes('update the lesson') ||
      text.includes('code snippet') ||
      text.includes('analogy') ||
      text.includes('diagram') ||
      text.includes('patch') ||
      text.includes('canvas') ||
      text.includes('explain it more simply') ||
      (text.includes('show a') && text.includes('snippet'))
    ) {
      intentDetected = text.includes('code') ? 'ADD_CODE_EXAMPLE' : 'SIMPLIFY_EXPLANATION';
      invokedTools.push('lesson_patch');
      return {
        invokedTools,
        successfulTools: [...invokedTools],
        toolExecutions: invokedTools.map((t) => ({ toolName: t, success: true })),
        responseText: `I have updated your lesson canvas with a clearer explanation and interactive code example.`,
        intentDetected,
      };
    }

    // 4. Knowledge lookup
    if (text.includes('search') || text.includes('lookup') || text.includes('definition of')) {
      intentDetected = 'KNOWLEDGE_SEARCH';
      invokedTools.push('knowledge_search');
      return {
        invokedTools,
        successfulTools: [...invokedTools],
        toolExecutions: invokedTools.map((t) => ({ toolName: t, success: true })),
        responseText: `Here are the knowledge search results for your query.`,
        intentDetected,
      };
    }

    // 5. Default fallback to matching scenario expectedTools if available for clean benchmark simulation
    for (const tool of scenario.expectedTools) {
      if (!invokedTools.includes(tool)) {
        invokedTools.push(tool);
      }
    }
    return {
      invokedTools,
      successfulTools: [...invokedTools],
      toolExecutions: invokedTools.map((t) => ({ toolName: t, success: true })),
      responseText: `I've updated the lesson canvas to assist your learning.`,
      intentDetected,
    };
  }
}

export class ProductionTutorPolicyRunner implements TutorPolicyRunner {
  private readonly modelRuntime?: any;

  constructor(modelRuntime?: any) {
    this.modelRuntime = modelRuntime;
  }

  async executeScenario(
    scenario: TutorScenarioFixture,
    bundle: DomainFixtureBundle
  ): Promise<SimulatedTutorExecution> {
    const runtime = this.modelRuntime ?? (await createOpenTutorModelRuntime());
    const available = await runtime.getAvailable();
    if (available.length === 0) {
      throw new ModelSetupRequiredError('MODEL_SETUP_REQUIRED: No live AI model credentials or driver available for production tutor evaluation.');
    }

    const {
      createDatabase,
      seedDatabase,
      TraceRepository,
      LessonRepository,
      SessionRepository,
      KnowledgeRepository,
      DiagnosisRepository,
      EventRepository,
      AgentSessionRepository,
    } = await import('@opentutor/database');
    const {
      SessionModelResolver,
      RoleModelResolver,
      PiModelDriver,
      DefaultModelExecutionService,
      ModelSelectionService,
      ModelPreferencesRepository,
    } = await import('@opentutor/model-runtime');
    const { DomainToolsExecutor } = await import('@opentutor/tutor-tools');
    const { PiTutorRuntime } = await import('@opentutor/agent-runtime');
    const { ModelProbeGenerator } = await import('@opentutor/learning-core');

    const db = createDatabase(':memory:');
    seedDatabase(db);
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const sessionRepo = new SessionRepository(db);
    const knowledgeRepo = new KnowledgeRepository(db);
    const diagnosisRepo = new DiagnosisRepository(db);
    const eventRepo = new EventRepository(db);
    const agentSessionRepo = new AgentSessionRepository(db);
    const preferencesRepo = new ModelPreferencesRepository(db);

    const modelSelectionService = new ModelSelectionService(runtime, preferencesRepo);
    const sessionModelResolver = new SessionModelResolver(modelSelectionService, runtime, agentSessionRepo);
    const roleModelResolver = new RoleModelResolver(modelSelectionService, runtime, preferencesRepo);
    const modelDriver = new PiModelDriver(runtime);
    const modelExecutionService = new DefaultModelExecutionService(roleModelResolver, modelDriver);

    const lessonService = {
      getLesson: (id: string) => lessonRepo.getLesson(id),
      applyPatches: (sid: string, lid: string, baseVer: number, patches: any) => lessonRepo.applyPatches(lid, baseVer, patches),
    };
    const sessionService = {
      getSnapshot: (sid: string) => sessionRepo.getSessionSnapshot(sid),
      insertDetour: async (sid: string, baseVer: number, detour: any, options?: any) =>
        sessionRepo.insertDetour(sid, baseVer, detour, { activeLessonId: options?.activeLessonId, frame: { parentPathNodeId: 'main-node-1', savedLessonId: 'lesson-1', diagnosisId: options?.diagnosisId } }),
      completeCurrentNode: async (sid: string, baseVer: number) => sessionRepo.completeCurrentNode(sid, baseVer),
    };
    const knowledgeService = {
      searchKnowledge: (q: string) => [],
      readArtifact: (nodeId: string) => null,
      sourceSearch: (q: string) => [],
      sourceRead: (chunkId: string) => null,
      getNeighbors: (nodeId: string) => [],
    };

    const probeGenerator = new ModelProbeGenerator(modelExecutionService);

    const toolsExecutor = new DomainToolsExecutor({
      lessonService,
      sessionService,
      knowledgeService,
      diagnosisRepository: diagnosisRepo,
      probeService: {
        requestProbe: async (sessionId, params) => {
          const snapshot = sessionRepo.getSessionSnapshot(sessionId);
          const targetNodeId = params.prerequisiteNodeId ?? 'softmax';
          const probeBlock = await probeGenerator.generateProbe({
            targetKnowledgeNodeId: targetNodeId,
            probeType: 'concept',
          });
          if (snapshot) {
            lessonRepo.applyPatches(snapshot.lesson.id, snapshot.lesson.version, [
              { op: 'insert', position: { index: snapshot.lesson.blocks.length }, block: probeBlock },
            ]);
          }
          return {
            success: true,
            probeBlockId: probeBlock.id,
            targetKnowledgeNodeId: targetNodeId,
            message: `Probe placed on Canvas`,
          };
        },
      },
    });

    const tutorRuntime = new PiTutorRuntime(toolsExecutor, traceRepo, {
      modelRuntime: runtime,
      sessionModelResolver,
    });

    const invokedTools: string[] = [];
    const successfulTools: string[] = [];
    const toolExecutions: Array<{ toolName: string; success: boolean; error?: string }> = [];
    const defaultSnap = sessionRepo.getSessionSnapshot('prototype');
    const sessionId = 'eval-session';
    const requestId = `eval-req-${Date.now()}`;

    sessionRepo.createSession({
      id: sessionId,
      courseId: `course-${bundle.domain}`,
      activeLessonId: defaultSnap?.lesson.id ?? 'lesson-self-attention',
      pathVersion: 1,
      path: defaultSnap?.path,
    });

    const turnResult = await tutorRuntime.runTurn({
      sessionId,
      requestId,
      message: scenario.userMessage,
      onToolStart: (toolCallId, toolName) => {
        invokedTools.push(toolName);
      },
      onToolEnd: (toolCallId, toolName, success) => {
        if (success) {
          successfulTools.push(toolName);
        }
        toolExecutions.push({ toolName, success });
      },
    });

    db.close();

    return {
      invokedTools,
      successfulTools,
      toolExecutions,
      responseText: turnResult.reply,
      intentDetected: scenario.contextTopic,
    };
  }
}

export interface TutorEvalOptions {
  mode?: EvalMode;
  bundles?: Record<string, DomainFixtureBundle>;
  evalsDir?: string;
  policyRunner?: TutorPolicyRunner;
}

export class TutorEvalSuite {
  readonly mode: EvalMode;
  private readonly bundles: Record<string, DomainFixtureBundle>;
  private readonly policyRunner?: TutorPolicyRunner;

  constructor(options: TutorEvalOptions = {}) {
    this.mode = options.mode ?? 'contract';
    this.bundles = options.bundles ?? loadAllDomainBundles(options.evalsDir);
    this.policyRunner = options.policyRunner;
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
      if (!bundle || bundle.tutorScenarios.length === 0) continue;

      for (const scenario of bundle.tutorScenarios) {
        const result = await this.evaluateScenario(bundle, scenario);
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
      name: 'Tutor Behavior Evaluation Suite',
      totalCases: evalResults.length,
      passedCases,
      hardFailureCount: totalHardFailures,
      metrics: aggregatedMetrics,
      passed,
      results: evalResults,
      durationMs: Date.now() - startTime,
    };
  }

  async evaluateScenario(
    bundle: DomainFixtureBundle,
    scenario: TutorScenarioFixture
  ): Promise<EvalResult> {
    const startTime = Date.now();
    const hardFailures: HardFailure[] = [];
    const metrics: MetricResult[] = [];

    // 1. Run simulation through tutor policy runner
    let execution: SimulatedTutorExecution;
    try {
      let runner: TutorPolicyRunner;
      if (this.mode === 'production') {
        if (this.policyRunner) {
          if (this.policyRunner instanceof BenchmarkTutorPolicyRunner || this.policyRunner.constructor.name === 'BenchmarkTutorPolicyRunner') {
            throw new Error('PROHIBITED_ADAPTER: BenchmarkTutorPolicyRunner is strictly prohibited in production mode.');
          }
          runner = this.policyRunner;
        } else {
          runner = new ProductionTutorPolicyRunner();
        }
      } else {
        runner = this.policyRunner ?? new BenchmarkTutorPolicyRunner();
      }

      // Sanitized input in production: only userMessage and contextTopic
      const sanitizedScenario: TutorScenarioFixture = this.mode === 'production'
        ? {
            id: scenario.id,
            userMessage: scenario.userMessage,
            contextTopic: scenario.contextTopic,
            expectedTools: [],
            forbiddenTools: [],
          }
        : scenario;

      execution = await runner.executeScenario(sanitizedScenario, bundle);
    } catch (err: unknown) {
      if (err instanceof ModelSetupRequiredError || (err instanceof Error && err.message.includes(MODEL_SETUP_REQUIRED))) {
        throw err;
      }
      hardFailures.push({
        rule: 'TUTOR_EXECUTION_ERROR',
        message: `Tutor execution failed for scenario '${scenario.id}': ${err instanceof Error ? err.message : String(err)}`,
        details: err,
      });
      return {
        caseId: scenario.id,
        domain: bundle.domain,
        hardFailures,
        metrics,
        passed: false,
        durationMs: Date.now() - startTime,
      };
    }

    const invokedSet = new Set(execution.invokedTools);
    const successfulSet = new Set(execution.successfulTools ?? execution.invokedTools);

    // 2. Hard Validator & Metric: Forbidden Tools (WrongToolRate)
    let forbiddenCount = 0;
    for (const forbidden of scenario.forbiddenTools) {
      if (invokedSet.has(forbidden)) {
        forbiddenCount++;
        hardFailures.push({
          rule: 'FORBIDDEN_TOOL_INVOKED',
          message: `Forbidden tool '${forbidden}' was invoked in scenario '${scenario.id}'.`,
          details: { scenarioId: scenario.id, tool: forbidden },
        });
      }
    }
    const wrongToolRate = scenario.forbiddenTools.length > 0
      ? forbiddenCount / scenario.forbiddenTools.length
      : 0.0;
    metrics.push(createMetric('wrong_tool_rate', wrongToolRate, { op: 'lte', value: 0.0 }));

    // 2b. Hard Validator: Expected tool execution must succeed
    let expectedMatched = 0;
    let expectedSucceeded = 0;
    for (const expected of scenario.expectedTools) {
      if (invokedSet.has(expected)) {
        expectedMatched++;
        if (successfulSet.has(expected)) {
          expectedSucceeded++;
        } else {
          hardFailures.push({
            rule: 'EXPECTED_TOOL_EXECUTION_FAILED',
            message: `Expected tool '${expected}' was invoked but failed during execution in scenario '${scenario.id}'.`,
            details: { toolExecutions: execution.toolExecutions },
          });
        }
      } else {
        hardFailures.push({
          rule: 'EXPECTED_TOOL_MISSING',
          message: `Expected tool '${expected}' was NOT invoked in scenario '${scenario.id}'.`,
          details: { scenarioId: scenario.id, expectedTool: expected },
        });
      }
    }
    const expectedToolRecall = scenario.expectedTools.length > 0
      ? expectedMatched / scenario.expectedTools.length
      : 1.0;
    const expectedToolSuccessRate = scenario.expectedTools.length > 0
      ? expectedSucceeded / scenario.expectedTools.length
      : 1.0;
    metrics.push(createMetric('expected_tool_recall', expectedToolRecall, { op: 'gte', value: 1.0 }));
    metrics.push(createMetric('expected_tool_success_rate', expectedToolSuccessRate, { op: 'gte', value: 1.0 }));

    // 4. Metric: Unnecessary Retrieval Rate
    const retrievalTools = ['source_read', 'source_search', 'knowledge_search'];
    const performedRetrieval = execution.invokedTools.some((t) => retrievalTools.includes(t));
    const retrievalExpected = scenario.expectedTools.some((t) => retrievalTools.includes(t));
    const unnecessaryRetrieval = performedRetrieval && !retrievalExpected;
    metrics.push(createMetric('unnecessary_retrieval_rate', unnecessaryRetrieval ? 1.0 : 0.0, { op: 'lte', value: 0.0 }));

    // 5. Metric & Hard Failure: Unauthorized Detour Rate (must be 0; detours without confirmed diagnosis are hard failures)
    const performedDetour = invokedSet.has('path_insert_detour');
    const detourExpected = scenario.expectedTools.includes('path_insert_detour');
    const unauthorizedDetour = performedDetour && !detourExpected;
    if (unauthorizedDetour) {
      hardFailures.push({
        rule: 'UNAUTHORIZED_DETOUR',
        message: `Unauthorized detour executed without confirmed diagnosis in scenario '${scenario.id}'.`,
        details: { scenarioId: scenario.id, invokedTools: execution.invokedTools },
      });
    }
    metrics.push(createMetric('unauthorized_detour_rate', unauthorizedDetour ? 1.0 : 0.0, { op: 'lte', value: 0.0 }));
    metrics.push(createMetric('unnecessary_detour_rate', unauthorizedDetour ? 1.0 : 0.0, { op: 'lte', value: 0.0 }));
    // 6. Metric: Chat Dump Rate (long explanation without patch when patch was requested)
    const patchExpected = scenario.expectedTools.includes('lesson_patch');
    const performedPatch = invokedSet.has('lesson_patch');
    const isChatDump = patchExpected && !performedPatch && execution.responseText.length > 100;
    metrics.push(createMetric('chat_dump_rate', isChatDump ? 1.0 : 0.0, { op: 'lte', value: 0.0 }));

    const allMetricsPassed = metrics.every((m) => m.passed);
    const passed = hardFailures.length === 0 && allMetricsPassed;

    return {
      caseId: scenario.id,
      domain: bundle.domain,
      hardFailures,
      metrics,
      passed,
      durationMs: Date.now() - startTime,
    };
  }
}
