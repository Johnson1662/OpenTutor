import { BetaMasteryAggregator } from '@opentutor/assessment-core';
import type {
  LearningEvidence,
  UserKnowledgeState,
} from '@opentutor/protocol';
import type {
  DomainFixtureBundle,
  EvalResult,
  EvalSuiteResult,
  HardFailure,
  MetricResult,
} from '../core/index.ts';
import {
  createMetric,
  loadAllDomainBundles,
} from '../core/index.ts';

export interface LearnerEvalOptions {
  bundles?: Record<string, DomainFixtureBundle>;
  evalsDir?: string;
}

export class LearnerEvalSuite {
  private readonly bundles: Record<string, DomainFixtureBundle>;
  private readonly aggregator: BetaMasteryAggregator;

  constructor(options: LearnerEvalOptions = {}) {
    this.bundles = options.bundles ?? loadAllDomainBundles(options.evalsDir);
    this.aggregator = new BetaMasteryAggregator();
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

    // If no domain bundles found or running standalone synthetic cases:
    if (evalResults.length === 0) {
      const syntheticResult = await this.evaluateSynthetic();
      evalResults.push(syntheticResult);
      totalHardFailures += syntheticResult.hardFailures.length;
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
      name: 'Learner Model v2 & Evidence Aggregation Suite',
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

    const entities = bundle.knowledge?.entities ?? [];
    const testNodes = entities.length > 0 ? entities.map((e) => e.id) : ['synthetic-node-1', 'synthetic-node-2'];

    // 1. Benchmark: OneAnswerMasteryImpossibleRate
    // Verify that NO single answer (regardless of difficulty, confidence, or correctness) achieves 'mastered'.
    let singleAnswerTotal = 0;
    let singleAnswerViolations = 0;

    const testDifficulties: Array<number | 'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard', 0.1, 0.5, 1.0, 1.4, 2.0, 5.0, 10.0];
    const testOutcomes: Array<'correct' | 'partial' | 'incorrect'> = ['correct', 'partial', 'incorrect'];

    for (const nodeId of testNodes) {
      for (const diff of testDifficulties) {
        for (const outcome of testOutcomes) {
          singleAnswerTotal++;
          const evidence: LearningEvidence = {
            id: `ev-${nodeId}-${singleAnswerTotal}`,
            userId: 'eval-user',
            knowledgeNodeId: nodeId,
            type: 'quiz',
            source: 'eval-suite',
            outcome,
            difficulty: typeof diff === 'number' ? diff : (diff === 'easy' ? 0.6 : diff === 'hard' ? 1.4 : 1.0),
            confidence: 1.0,
            weight: (typeof diff === 'number' ? diff : (diff === 'easy' ? 0.6 : diff === 'hard' ? 1.4 : 1.0)),
            createdAt: '2026-08-01T00:00:00.000Z',
          };

          const state = this.aggregator.updateMastery(null, evidence);
          if (state.status === 'mastered') {
            singleAnswerViolations++;
            hardFailures.push({
              rule: 'ONE_ANSWER_MASTERY_VIOLATION',
              message: `Single answer resulted in 'mastered' status for node '${nodeId}' (difficulty: ${diff}, outcome: ${outcome}, p: ${state.masteryProbability}).`,
              details: { nodeId, diff, outcome, state },
            });
          }
          if (state.evidenceCount !== 1) {
            hardFailures.push({
              rule: 'EVIDENCE_COUNT_MISMATCH',
              message: `Expected evidenceCount 1, got ${state.evidenceCount}.`,
              details: { state },
            });
          }
        }
      }
    }

    const oneAnswerImpossibleRate = singleAnswerTotal > 0 ? (singleAnswerTotal - singleAnswerViolations) / singleAnswerTotal : 1.0;
    metrics.push(createMetric('OneAnswerMasteryImpossibleRate', oneAnswerImpossibleRate, { op: 'gte', value: 1.0 }));

    // 2. Benchmark: EvidenceAggregationDeterminism
    // Verify that independent aggregator instances aggregate identical evidence deterministically.
    let determinismChecks = 0;
    let determinismMatches = 0;

    for (const nodeId of testNodes.slice(0, 5)) {
      determinismChecks++;
      const aggregator1 = new BetaMasteryAggregator();
      const aggregator2 = new BetaMasteryAggregator();

      let s1: UserKnowledgeState | null = null;
      let s2: UserKnowledgeState | null = null;

      const sequence: Array<{ outcome: 'correct' | 'partial' | 'incorrect'; diff: 'easy' | 'medium' | 'hard' }> = [
        { outcome: 'correct', diff: 'medium' },
        { outcome: 'correct', diff: 'hard' },
        { outcome: 'partial', diff: 'easy' },
        { outcome: 'incorrect', diff: 'medium' },
        { outcome: 'correct', diff: 'hard' },
      ];

      for (let i = 0; i < sequence.length; i++) {
        const item = sequence[i];
        const ev: LearningEvidence = {
          id: `ev-seq-${i}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'quiz',
          source: 'eval-seq',
          outcome: item.outcome,
          difficulty: item.diff === 'easy' ? 0.6 : item.diff === 'hard' ? 1.4 : 1.0,
          confidence: 0.9,
          weight: (item.diff === 'easy' ? 0.6 : item.diff === 'hard' ? 1.4 : 1.0) * 0.9,
          createdAt: `2026-08-01T0${i}:00:00.000Z`,
        };
        s1 = aggregator1.updateMastery(s1, ev);
        s2 = aggregator2.updateMastery(s2, ev);
      }

      if (
        s1 && s2 &&
        s1.alpha !== undefined && s2.alpha !== undefined &&
        s1.beta !== undefined && s2.beta !== undefined &&
        s1.masteryProbability !== undefined && s2.masteryProbability !== undefined &&
        Math.abs(s1.alpha - s2.alpha) < 1e-9 &&
        Math.abs(s1.beta - s2.beta) < 1e-9 &&
        Math.abs(s1.masteryProbability - s2.masteryProbability) < 1e-9 &&
        s1.status === s2.status &&
        s1.evidenceCount === s2.evidenceCount &&
        s1.correctCount === s2.correctCount &&
        s1.incorrectCount === s2.incorrectCount
      ) {
        determinismMatches++;
      } else {
        hardFailures.push({
          rule: 'DETERMINISM_VIOLATION',
          message: `Aggregator instances produced non-deterministic results for node '${nodeId}'.`,
          details: { s1, s2 },
        });
      }
    }

    const determinismRate = determinismChecks > 0 ? determinismMatches / determinismChecks : 1.0;
    metrics.push(createMetric('EvidenceAggregationDeterminism', determinismRate, { op: 'gte', value: 1.0 }));

    // 3. Benchmark: DecayMonotonicity
    // Verify that forgetting decay is strictly monotonic over time intervals.
    let decayChecks = 0;
    let decayMatches = 0;

    const baseStateHigh: UserKnowledgeState = {
      userId: 'eval-user',
      knowledgeNodeId: 'node-high',
      status: 'mastered',
      confidence: 0.90,
      masteryProbability: 0.90,
      alpha: 9.0,
      beta: 1.0,
      evidenceCount: 5,
      correctCount: 5,
      incorrectCount: 0,
      stability: 7.0,
      difficulty: 1.0,
      lastAssessedAt: '2026-08-01T00:00:00.000Z',
    };

    const baseStateLow: UserKnowledgeState = {
      userId: 'eval-user',
      knowledgeNodeId: 'node-low',
      status: 'weak',
      confidence: 0.20,
      masteryProbability: 0.20,
      alpha: 1.0,
      beta: 4.0,
      evidenceCount: 4,
      correctCount: 0,
      incorrectCount: 4,
      stability: 7.0,
      difficulty: 1.0,
      lastAssessedAt: '2026-08-01T00:00:00.000Z',
    };

    const intervals = [1, 3, 7, 14, 30, 60, 90];
    let prevHighProb = baseStateHigh.masteryProbability ?? 0.90;
    let prevLowProb = baseStateLow.masteryProbability ?? 0.20;
    let prevHighAlpha = baseStateHigh.alpha ?? 9.0;
    let prevLowBeta = baseStateLow.beta ?? 4.0;

    let highMonotonic = true;
    let lowMonotonic = true;

    for (const days of intervals) {
      decayChecks++;
      const targetTime = new Date(new Date(baseStateHigh.lastAssessedAt!).getTime() + days * 86400000).toISOString();
      const decayedHigh = this.aggregator.projectMasteryAt(baseStateHigh, targetTime);
      const decayedLow = this.aggregator.projectMasteryAt(baseStateLow, targetTime);

      const highProb = decayedHigh.masteryProbability ?? 0.5;
      const highAlpha = decayedHigh.alpha ?? 1.0;
      const lowProb = decayedLow.masteryProbability ?? 0.5;
      const lowBeta = decayedLow.beta ?? 1.0;

      // High mastery should decay downwards towards 0.5
      if (highProb > prevHighProb || highAlpha > prevHighAlpha) {
        highMonotonic = false;
      }
      // Low mastery should decay upwards towards 0.5
      if (lowProb < prevLowProb || lowBeta > prevLowBeta) {
        lowMonotonic = false;
      }

      prevHighProb = highProb;
      prevHighAlpha = highAlpha;
      prevLowProb = lowProb;
      prevLowBeta = lowBeta;
    }
    if (highMonotonic && lowMonotonic) {
      decayMatches = decayChecks;
    } else {
      hardFailures.push({
        rule: 'DECAY_MONOTONICITY_VIOLATION',
        message: `Decay projection failed monotonicity check across intervals ${intervals.join(', ')} days.`,
        details: { highMonotonic, lowMonotonic },
      });
    }

    const decayMonotonicityRate = decayChecks > 0 ? decayMatches / decayChecks : 1.0;
    metrics.push(createMetric('DecayMonotonicity', decayMonotonicityRate, { op: 'gte', value: 1.0 }));

    // 4. Benchmark: ThresholdConsistency
    // Verify that status corresponds exactly to the mathematical bounds:
    // - evidenceCount < 1 => 'unknown'
    // - p < 0.40 => 'weak'
    // - 0.40 <= p < 0.85 => 'learning'
    // - p >= 0.85 and count < 3 => 'learning'
    // - p >= 0.85 and count >= 3 => 'mastered'
    let thresholdChecks = 0;
    let thresholdMatches = 0;

    const alphaValues = [0.1, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 20.0];
    const betaValues = [0.1, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 20.0];
    const counts = [0, 1, 2, 3, 4, 5, 10];

    for (const a of alphaValues) {
      for (const b of betaValues) {
        for (const cnt of counts) {
          thresholdChecks++;
          const p = a / (a + b);
          const computedStatus = this.aggregator.computeStatus(p, cnt);

          let expectedStatus: 'unknown' | 'weak' | 'learning' | 'mastered';
          if (cnt < 1) {
            expectedStatus = 'unknown';
          } else if (p < 0.40) {
            expectedStatus = 'weak';
          } else if (p >= 0.85 && cnt >= 3) {
            expectedStatus = 'mastered';
          } else {
            expectedStatus = 'learning';
          }

          if (computedStatus === expectedStatus) {
            thresholdMatches++;
          } else {
            hardFailures.push({
              rule: 'THRESHOLD_CONSISTENCY_VIOLATION',
              message: `Status mismatch for alpha=${a}, beta=${b}, p=${p.toFixed(3)}, count=${cnt}: expected '${expectedStatus}', got '${computedStatus}'.`,
              details: { a, b, p, cnt, expectedStatus, computedStatus },
            });
          }
        }
      }
    }

    const thresholdConsistencyRate = thresholdChecks > 0 ? thresholdMatches / thresholdChecks : 1.0;
    metrics.push(createMetric('ThresholdConsistency', thresholdConsistencyRate, { op: 'gte', value: 1.0 }));

    const allMetricsPassed = metrics.every((m) => m.passed);
    const passed = hardFailures.length === 0 && allMetricsPassed;

    return {
      caseId: `learner-${bundle.domain}`,
      domain: bundle.domain,
      hardFailures,
      metrics,
      passed,
      durationMs: Date.now() - startTime,
    };
  }

  async evaluateSynthetic(): Promise<EvalResult> {
    const syntheticBundle: DomainFixtureBundle = {
      domain: 'synthetic',
      sourceText: '',
      knowledge: {
        entities: [
          { id: 'synth-1', canonicalName: 'Synthetic 1', definition: 'Synthetic definition 1' },
          { id: 'synth-2', canonicalName: 'Synthetic 2', definition: 'Synthetic definition 2' },
        ],
      },
      courseCases: [],
      lessonCases: [],
      tutorScenarios: [],
      relations: [],
      forbiddenMerges: [],
      aliases: [],
    };
    return this.evaluateDomain(syntheticBundle);
  }
}
