import type { EvalCase, EvalResult, EvalSuiteResult, HardFailure, MetricResult } from './eval-case.ts';
import { runHardValidators, type HardValidator } from './validator.ts';

export interface EvalExecutionOptions<TInput, TExpected, TActual> {
  validators?: HardValidator<TActual, TExpected>[];
  metricCalculators?: Array<(actual: TActual, expected: TExpected, evalCase: EvalCase<TInput, TExpected>) => Promise<MetricResult[]> | MetricResult[]>;
}

export async function runEvalCase<TInput, TExpected, TActual>(
  evalCase: EvalCase<TInput, TExpected>,
  executor: (input: TInput, evalCase: EvalCase<TInput, TExpected>) => Promise<TActual> | TActual,
  options: EvalExecutionOptions<TInput, TExpected, TActual> = {}
): Promise<EvalResult> {
  const startTime = Date.now();
  const hardFailures: HardFailure[] = [];
  const metrics: MetricResult[] = [];

  let actual: TActual;
  try {
    actual = await executor(evalCase.input, evalCase);
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    return {
      caseId: evalCase.id,
      domain: evalCase.domain,
      hardFailures: [
        {
          rule: 'EXECUTION_ERROR',
          message: `Execution failed with exception: ${err instanceof Error ? err.message : String(err)}`,
          details: err,
        },
      ],
      metrics: [],
      passed: false,
      durationMs,
    };
  }

  // 1. Run Hard Validators (Deterministic invariant checks)
  if (options.validators && options.validators.length > 0) {
    const validationFailures = await runHardValidators(
      options.validators,
      actual,
      evalCase.expected,
      { caseId: evalCase.id, domain: evalCase.domain, metadata: evalCase.metadata }
    );
    hardFailures.push(...validationFailures);
  }

  // 2. Run Metric Calculators
  if (options.metricCalculators && options.metricCalculators.length > 0) {
    for (const calc of options.metricCalculators) {
      try {
        const calculatedMetrics = await calc(actual, evalCase.expected, evalCase);
        metrics.push(...calculatedMetrics);
      } catch (err: unknown) {
        hardFailures.push({
          rule: 'METRIC_CALCULATION_ERROR',
          message: `Metric calculation failed: ${err instanceof Error ? err.message : String(err)}`,
          details: err,
        });
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const metricsPassed = metrics.every((m) => m.passed);
  const passed = hardFailures.length === 0 && metricsPassed;

  return {
    caseId: evalCase.id,
    domain: evalCase.domain,
    hardFailures,
    metrics,
    passed,
    durationMs,
    details: {
      actual,
    },
  };
}

export async function runEvalSuite<TInput, TExpected, TActual>(
  suiteName: string,
  cases: EvalCase<TInput, TExpected>[],
  executor: (input: TInput, evalCase: EvalCase<TInput, TExpected>) => Promise<TActual> | TActual,
  options: EvalExecutionOptions<TInput, TExpected, TActual> = {}
): Promise<EvalSuiteResult> {
  const startTime = Date.now();
  const results: EvalResult[] = [];

  for (const c of cases) {
    const res = await runEvalCase(c, executor, options);
    results.push(res);
  }

  let totalHardFailures = 0;
  let passedCount = 0;
  const metricSums: Record<string, { sum: number; count: number }> = {};

  for (const r of results) {
    if (r.passed) passedCount++;
    totalHardFailures += r.hardFailures.length;

    for (const m of r.metrics) {
      if (!metricSums[m.name]) {
        metricSums[m.name] = { sum: 0, count: 0 };
      }
      metricSums[m.name].sum += m.value;
      metricSums[m.name].count += 1;
    }
  }

  const aggregatedMetrics: Record<string, number> = {};
  for (const [name, data] of Object.entries(metricSums)) {
    aggregatedMetrics[name] = data.count > 0 ? Number((data.sum / data.count).toFixed(4)) : 0;
  }

  const suitePassed = totalHardFailures === 0 && passedCount === cases.length;
  const durationMs = Date.now() - startTime;

  return {
    name: suiteName,
    totalCases: cases.length,
    passedCases: passedCount,
    hardFailureCount: totalHardFailures,
    metrics: aggregatedMetrics,
    passed: suitePassed,
    results,
    durationMs,
  };
}
