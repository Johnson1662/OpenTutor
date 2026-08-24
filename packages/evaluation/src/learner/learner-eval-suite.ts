import { BetaMasteryAggregator, type UserKnowledgeStateV2 } from '@opentutor/assessment-core';
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
  EvalMode,
} from '../core/index.ts';
import {
  createMetric,
  loadAllDomainBundles,
} from '../core/index.ts';

export interface LearnerEvalOptions {
  mode?: EvalMode;
  bundles?: Record<string, DomainFixtureBundle>;
  evalsDir?: string;
}

export class LearnerEvalSuite {
  readonly mode: EvalMode;
  private readonly bundles: Record<string, DomainFixtureBundle>;
  private readonly aggregator: BetaMasteryAggregator;

  constructor(options: LearnerEvalOptions = {}) {
    this.mode = options.mode ?? 'contract';
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

    // 1. Test 1: same-item-spam-never-mastered
    // Repeated answers to a single quiz item (even 10 correct attempts) cannot achieve 'mastered'.
    let spamChecks = 0;
    let spamViolations = 0;

    for (const nodeId of testNodes.slice(0, 3)) {
      spamChecks++;
      let state: UserKnowledgeState | null = null;
      const singleItemId = `quiz-single-${nodeId}`;

      for (let attempt = 1; attempt <= 10; attempt++) {
        const ev: LearningEvidence = {
          id: `ev-spam-${nodeId}-${attempt}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'quiz',
          source: 'eval-suite',
          sourceItemId: singleItemId,
          attempt,
          outcome: 'correct',
          difficulty: 1.4,
          confidence: 1.0,
          weight: 1.4,
          createdAt: `2026-08-01T12:${attempt.toString().padStart(2, '0')}:00.000Z`,
        };
        state = this.aggregator.updateMastery(state, ev);
      }

      if (state && state.status === 'mastered') {
        spamViolations++;
        hardFailures.push({
          rule: 'SAME_ITEM_SPAM_MASTERY_VIOLATION',
          message: `Repeated attempts on a single item erroneously achieved 'mastered' status for node '${nodeId}' (distinctSourceItemCount: ${state.distinctSourceItemCount}).`,
          details: { nodeId, state },
        });
      }
      if (state && (state.distinctSourceItemCount ?? 0) > 1) {
        hardFailures.push({
          rule: 'DISTINCT_ITEM_COUNT_MISMATCH',
          message: `Expected distinctSourceItemCount 1, got ${state.distinctSourceItemCount}.`,
          details: { state },
        });
      }
    }

    const sameItemSpamNeverMasteredRate = spamChecks > 0 ? (spamChecks - spamViolations) / spamChecks : 1.0;
    metrics.push(createMetric('same-item-spam-never-mastered', sameItemSpamNeverMasteredRate, { op: 'gte', value: 1.0 }));
    metrics.push(createMetric('OneAnswerMasteryImpossibleRate', sameItemSpamNeverMasteredRate, { op: 'gte', value: 1.0 }));

    // 2. Test 2: incorrect-evidence-lowers-mastery
    // Negative evidence decreases probability and increases beta.
    let incorrectChecks = 0;
    let incorrectMatches = 0;

    for (const nodeId of testNodes.slice(0, 3)) {
      incorrectChecks++;
      let state: UserKnowledgeState | null = null;

      // Seed with 2 correct answers on distinct items
      state = this.aggregator.updateMastery(state, {
        id: `ev-seed-1-${nodeId}`,
        userId: 'eval-user',
        knowledgeNodeId: nodeId,
        type: 'quiz',
        source: 'eval-suite',
        sourceItemId: `item-seed-1-${nodeId}`,
        attempt: 1,
        outcome: 'correct',
        difficulty: 1.0,
        confidence: 1.0,
        weight: 1.0,
        createdAt: '2026-08-01T10:00:00.000Z',
      });
      state = this.aggregator.updateMastery(state, {
        id: `ev-seed-2-${nodeId}`,
        userId: 'eval-user',
        knowledgeNodeId: nodeId,
        type: 'quiz',
        source: 'eval-suite',
        sourceItemId: `item-seed-2-${nodeId}`,
        attempt: 1,
        outcome: 'correct',
        difficulty: 1.0,
        confidence: 1.0,
        weight: 1.0,
        createdAt: '2026-08-01T10:05:00.000Z',
      });

      const probBefore = state.masteryProbability ?? (state.alpha! / (state.alpha! + state.beta!));
      const betaBefore = state.beta ?? 1.0;

      // Apply incorrect evidence
      state = this.aggregator.updateMastery(state, {
        id: `ev-inc-${nodeId}`,
        userId: 'eval-user',
        knowledgeNodeId: nodeId,
        type: 'quiz',
        source: 'eval-suite',
        sourceItemId: `item-seed-3-${nodeId}`,
        attempt: 1,
        outcome: 'incorrect',
        difficulty: 1.0,
        confidence: 1.0,
        weight: 1.0,
        createdAt: '2026-08-01T10:10:00.000Z',
      });

      const probAfter = state.masteryProbability ?? (state.alpha! / (state.alpha! + state.beta!));
      const betaAfter = state.beta ?? 1.0;

      if (probAfter < probBefore && betaAfter > betaBefore) {
        incorrectMatches++;
      } else {
        hardFailures.push({
          rule: 'INCORRECT_EVIDENCE_LOWER_MASTERY_VIOLATION',
          message: `Incorrect evidence failed to decrease probability or increase beta for node '${nodeId}'. Before: (p=${probBefore}, beta=${betaBefore}), After: (p=${probAfter}, beta=${betaAfter})`,
          details: { probBefore, probAfter, betaBefore, betaAfter },
        });
      }
    }

    const incorrectEvidenceLowersMasteryRate = incorrectChecks > 0 ? incorrectMatches / incorrectChecks : 1.0;
    metrics.push(createMetric('incorrect-evidence-lowers-mastery', incorrectEvidenceLowersMasteryRate, { op: 'gte', value: 1.0 }));

    // 3. Test 3: mastery-history-replay-equals-persisted
    // Replay of evidence sequence matches online updates.
    let replayChecks = 0;
    let replayMatches = 0;

    for (const nodeId of testNodes.slice(0, 3)) {
      replayChecks++;
      const evidences: LearningEvidence[] = [
        {
          id: `ev-rep-1-${nodeId}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'quiz',
          source: 'eval-suite',
          sourceItemId: `item-rep-1-${nodeId}`,
          attempt: 1,
          outcome: 'correct',
          difficulty: 1.0,
          confidence: 0.9,
          weight: 0.9,
          createdAt: '2026-08-01T10:00:00.000Z',
        },
        {
          id: `ev-rep-2-${nodeId}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'quiz',
          source: 'eval-suite',
          sourceItemId: `item-rep-2-${nodeId}`,
          attempt: 1,
          outcome: 'partial',
          difficulty: 1.2,
          confidence: 0.85,
          weight: 1.02,
          createdAt: '2026-08-01T11:00:00.000Z',
        },
        {
          id: `ev-rep-3-${nodeId}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'probe',
          source: 'eval-suite',
          sourceItemId: `item-rep-3-${nodeId}`,
          attempt: 1,
          outcome: 'correct',
          difficulty: 1.4,
          confidence: 1.0,
          weight: 1.4,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
      ];

      // Online sequential aggregation
      let onlineState: UserKnowledgeState | null = null;
      for (const ev of evidences) {
        onlineState = this.aggregator.updateMastery(onlineState, ev);
      }

      // Replay aggregation
      const replayState = this.aggregator.recomputeFromEvidenceHistory(evidences);

      if (
        onlineState && replayState &&
        Math.abs((onlineState.alpha ?? 0) - (replayState.alpha ?? 0)) < 1e-6 &&
        Math.abs((onlineState.beta ?? 0) - (replayState.beta ?? 0)) < 1e-6 &&
        Math.abs((onlineState.masteryProbability ?? 0) - (replayState.masteryProbability ?? 0)) < 1e-6 &&
        onlineState.status === replayState.status &&
        onlineState.evidenceCount === replayState.evidenceCount &&
        onlineState.distinctSourceItemCount === replayState.distinctSourceItemCount
      ) {
        replayMatches++;
      } else {
        hardFailures.push({
          rule: 'REPLAY_EQUALS_PERSISTED_VIOLATION',
          message: `Replay state did not match online sequential state for node '${nodeId}'.`,
          details: { onlineState, replayState },
        });
      }
    }

    const replayRate = replayChecks > 0 ? replayMatches / replayChecks : 1.0;
    metrics.push(createMetric('mastery-history-replay-equals-persisted', replayRate, { op: 'gte', value: 1.0 }));

    // 4. Test 4: two-plus-independent-items-required
    // Mastery requires distinctSourceItemCount >= 2 and effectiveEvidenceCount >= 3.
    let itemChecks = 0;
    let itemMatches = 0;

    for (const nodeId of testNodes.slice(0, 3)) {
      itemChecks++;
      // Case A: 5 correct attempts on 1 single item -> NOT mastered
      let stateSingle: UserKnowledgeState | null = null;
      for (let att = 1; att <= 5; att++) {
        stateSingle = this.aggregator.updateMastery(stateSingle, {
          id: `ev-single-${att}-${nodeId}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'quiz',
          source: 'eval-suite',
          sourceItemId: `single-item-${nodeId}`,
          attempt: att,
          outcome: 'correct',
          difficulty: 1.4,
          confidence: 1.0,
          weight: 1.4,
          createdAt: `2026-08-01T10:0${att}:00.000Z`,
        });
      }
      const singleNotMastered = stateSingle?.status !== 'mastered';

      // Case B: 3 distinct items with attempt=1, hard difficulty correct -> MASTERED
      let stateMulti: UserKnowledgeState | null = null;
      for (let itemIdx = 1; itemIdx <= 3; itemIdx++) {
        stateMulti = this.aggregator.updateMastery(stateMulti, {
          id: `ev-multi-${itemIdx}-${nodeId}`,
          userId: 'eval-user',
          knowledgeNodeId: nodeId,
          type: 'quiz',
          source: 'eval-suite',
          sourceItemId: `multi-item-${itemIdx}-${nodeId}`,
          attempt: 1,
          outcome: 'correct',
          difficulty: 2.0,
          confidence: 1.0,
          weight: 2.0,
          createdAt: `2026-08-01T11:0${itemIdx}:00.000Z`,
        });
      }
      const multiMastered = stateMulti?.status === 'mastered';

      if (singleNotMastered && multiMastered) {
        itemMatches++;
      } else {
        hardFailures.push({
          rule: 'INDEPENDENT_ITEMS_REQUIRED_VIOLATION',
          message: `Independent items requirement failed for node '${nodeId}'. singleNotMastered=${singleNotMastered}, multiMastered=${multiMastered}`,
          details: { stateSingle, stateMulti },
        });
      }
    }

    const independentItemsRate = itemChecks > 0 ? itemMatches / itemChecks : 1.0;
    metrics.push(createMetric('two-plus-independent-items-required', independentItemsRate, { op: 'gte', value: 1.0 }));

    // 5. Test 5: probe-evidence-targets-prerequisite-node
    // Probe evidence records on target prerequisite node, not active lesson node.
    let probeChecks = 0;
    let probeMatches = 0;
    const activeLessonNodeId = 'self-attention';
    const prereqNodeId = 'softmax';

    probeChecks++;
    // Create probe evidence targeting prerequisite node
    const probeEvidence: LearningEvidence = {
      id: 'probe-ev-1',
      userId: 'eval-user',
      knowledgeNodeId: prereqNodeId, // TARGET IS PREREQUISITE NODE
      type: 'probe',
      source: `probe-diagnostic-for-${activeLessonNodeId}`,
      sourceItemId: 'probe-softmax-quiz',
      attempt: 1,
      outcome: 'correct',
      difficulty: 1.0,
      confidence: 1.0,
      weight: 1.0,
      createdAt: '2026-08-01T12:00:00.000Z',
    };

    // Update prerequisite state
    const prereqState = this.aggregator.updateMastery(null, probeEvidence);

    // Verify evidence is recorded on prerequisite node, not active lesson node
    if (
      prereqState.knowledgeNodeId === prereqNodeId &&
      (prereqState.knowledgeNodeId as string) !== activeLessonNodeId &&
      prereqState.evidenceCount === 1 &&
      prereqState.correctCount === 1
    ) {
      probeMatches++;
    } else {
      hardFailures.push({
        rule: 'PROBE_TARGET_NODE_VIOLATION',
        message: `Probe evidence did not correctly target prerequisite node '${prereqNodeId}'.`,
        details: { prereqState },
      });
    }
    const probeTargetRate = probeChecks > 0 ? probeMatches / probeChecks : 1.0;
    metrics.push(createMetric('probe-evidence-targets-prerequisite-node', probeTargetRate, { op: 'gte', value: 1.0 }));
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
          const distinctItems = cnt >= 3 ? 2 : cnt;
          const computedStatus = this.aggregator.computeStatus(p, cnt, distinctItems, cnt);

          let expectedStatus: 'unknown' | 'weak' | 'learning' | 'mastered';
          if (cnt < 1) {
            expectedStatus = 'unknown';
          } else if (p < 0.40) {
            expectedStatus = 'weak';
          } else if (p >= 0.85 && cnt >= 3 && distinctItems >= 2) {
            expectedStatus = 'mastered';
          } else {
            expectedStatus = 'learning';
          }

          if (computedStatus === expectedStatus) {
            thresholdMatches++;
          } else {
            hardFailures.push({
              rule: 'THRESHOLD_CONSISTENCY_VIOLATION',
              message: `Status mismatch for alpha=${a}, beta=${b}, p=${p.toFixed(3)}, count=${cnt}, distinct=${distinctItems}: expected '${expectedStatus}', got '${computedStatus}'.`,
              details: { a, b, p, cnt, distinctItems, expectedStatus, computedStatus },
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
