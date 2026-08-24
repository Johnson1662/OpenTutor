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
        responseText: `I've added a focused detour to cover the prerequisite concept before we resume our main topic.`,
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
      text.includes('show a') && text.includes('snippet')
    ) {
      intentDetected = text.includes('code') ? 'ADD_CODE_EXAMPLE' : 'SIMPLIFY_EXPLANATION';
      invokedTools.push('lesson_patch');
      return {
        invokedTools,
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
      responseText: `Here is the explanation for ${scenario.contextTopic}.`,
      intentDetected,
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
          const runtime = await createOpenTutorModelRuntime();
          const available = await runtime.getAvailable();
          if (available.length === 0) {
            throw new ModelSetupRequiredError('MODEL_SETUP_REQUIRED: No live AI model credentials or driver available for production tutor evaluation.');
          }
          throw new ModelSetupRequiredError('MODEL_SETUP_REQUIRED: Production tutor agent requires configured model driver.');
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

    // 3. Metric: Expected Tool Recall
    let expectedMatched = 0;
    for (const expected of scenario.expectedTools) {
      if (invokedSet.has(expected)) {
        expectedMatched++;
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
    metrics.push(createMetric('expected_tool_recall', expectedToolRecall, { op: 'gte', value: 1.0 }));

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
