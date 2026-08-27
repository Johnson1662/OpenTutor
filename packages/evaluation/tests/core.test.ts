import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  loadAllDomainBundles,
  assertNoForbiddenMerges,
  assertAcyclic,
  assertPrerequisiteClosure,
  calculatePrecision,
  calculateRecall,
  calculateTopologicalValidity,
  createMetric,
  formatTerminalReport,
} from '../src/index.ts';

describe('@opentutor/evaluation core framework', () => {
  it('loads all 3 synthetic domain benchmark bundles cleanly', () => {
    const bundles = loadAllDomainBundles();
    assert.ok(bundles.transformer, 'Transformer domain bundle must be present');
    assert.ok(bundles.csapp, 'CSAPP domain bundle must be present');
    assert.ok(bundles.cpp, 'CPP domain bundle must be present');

    for (const [name, bundle] of Object.entries(bundles)) {
      assert.ok(bundle.sourceText.length > 50, `${name} sourceText should not be empty`);
      assert.ok(bundle.knowledge.entities.length > 0, `${name} entities should not be empty`);
      assert.ok(bundle.aliases.length > 0, `${name} aliases should not be empty`);
      assert.ok(bundle.forbiddenMerges.length > 0, `${name} forbiddenMerges should not be empty`);
      assert.ok(bundle.relations.length > 0, `${name} relations should not be empty`);
      assert.ok(bundle.courseCases.length > 0, `${name} courseCases should not be empty`);
      assert.ok(bundle.lessonCases.length > 0, `${name} lessonCases should not be empty`);
      assert.ok(bundle.tutorScenarios.length > 0, `${name} tutorScenarios should not be empty`);
    }
  });

  it('correctly executes hard validators and catches invariant violations', async () => {
    // 1. Forbidden merge validator
    const forbiddenMerges = [['Self Attention', 'Cross Attention'], ['Softmax', 'Attention']];
    const invalidClusters = [
      ['Self Attention', 'Cross Attention', 'Attention Variant'],
    ];
    const mergeFailures = assertNoForbiddenMerges(invalidClusters, forbiddenMerges);
    assert.equal(mergeFailures.length, 1);
    assert.equal(mergeFailures[0].rule, 'NO_FORBIDDEN_MERGES');

    const validClusters = [
      ['Self Attention', 'Self-Attention', 'Intra-Attention'],
      ['Cross Attention', 'Encoder-Decoder Attention'],
    ];
    const validMergeFailures = assertNoForbiddenMerges(validClusters, forbiddenMerges);
    assert.equal(validMergeFailures.length, 0);

    // 2. Cycle detector
    const cyclicEdges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ];
    const cycleFailures = assertAcyclic(['A', 'B', 'C'], cyclicEdges);
    assert.equal(cycleFailures.length, 1);
    assert.equal(cycleFailures[0].rule, 'NO_CYCLES');

    const acyclicEdges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ];
    const acyclicFailures = assertAcyclic(['A', 'B', 'C'], acyclicEdges);
    assert.equal(acyclicFailures.length, 0);

    // 3. Prerequisite closure validator
    const prereqMap = {
      'C': ['B'],
      'B': ['A'],
      'A': [],
    };
    const incompleteNodes = ['C']; // Missing 'B' and 'A'
    const closureFailures = assertPrerequisiteClosure(incompleteNodes, prereqMap);
    assert.equal(closureFailures.length, 1);
    assert.equal(closureFailures[0].rule, 'PREREQUISITE_CLOSURE');

    const completeNodes = ['A', 'B', 'C'];
    const completeClosureFailures = assertPrerequisiteClosure(completeNodes, prereqMap);
    assert.equal(completeClosureFailures.length, 0);
  });

  it('calculates metrics accurately', () => {
    const precision = calculatePrecision(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.equal(Number(precision.toFixed(4)), 0.6667);

    const recall = calculateRecall(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.equal(Number(recall.toFixed(4)), 0.6667);

    const topologicalOrder = ['A', 'B', 'C'];
    const validEdges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    assert.equal(calculateTopologicalValidity(topologicalOrder, validEdges), 1.0);

    const invalidOrder = ['C', 'B', 'A'];
    assert.equal(calculateTopologicalValidity(invalidOrder, validEdges), 0.0);
  });


  it('evaluates directional metric expectations (gte, lte, eq, gt, lt)', () => {
    // gte
    const mGtePass = createMetric('entity_recall', 0.95, { op: 'gte', value: 0.95 });
    assert.equal(mGtePass.passed, true);
    assert.deepEqual(mGtePass.expectation, { op: 'gte', value: 0.95 });
    const mGteFail = createMetric('entity_recall', 0.94, { op: 'gte', value: 0.95 });
    assert.equal(mGteFail.passed, false);

    // lte
    const mLtePass = createMetric('wrong_merge_rate', 0.01, { op: 'lte', value: 0.02 });
    assert.equal(mLtePass.passed, true);
    assert.deepEqual(mLtePass.expectation, { op: 'lte', value: 0.02 });
    const mLteFail = createMetric('wrong_merge_rate', 0.03, { op: 'lte', value: 0.02 });
    assert.equal(mLteFail.passed, false);

    // eq
    const mEqPass = createMetric('exact_score', 1.0, { op: 'eq', value: 1.0 });
    assert.equal(mEqPass.passed, true);
    const mEqFail = createMetric('exact_score', 0.9, { op: 'eq', value: 1.0 });
    assert.equal(mEqFail.passed, false);

    // gt and lt
    const mGt = createMetric('score', 0.8, { op: 'gt', value: 0.7 });
    assert.equal(mGt.passed, true);
    const mLt = createMetric('score', 0.6, { op: 'lt', value: 0.7 });
    assert.equal(mLt.passed, true);

    // Number expectation inference: lower is better names default to lte
    const mInferLower = createMetric('wrong_merge_rate', 0.0, 0.0);
    assert.equal(mInferLower.expectation?.op, 'lte');
    assert.equal(mInferLower.passed, true);

    const mInferLowerFail = createMetric('chat_dump_rate', 1.0, 0.0);
    assert.equal(mInferLowerFail.expectation?.op, 'lte');
    assert.equal(mInferLowerFail.passed, false);

    // Number expectation inference: higher is better defaults to gte
    const mInferHigher = createMetric('entity_recall', 0.96, 0.95);
    assert.equal(mInferHigher.expectation?.op, 'gte');
    assert.equal(mInferHigher.passed, true);
  });

  it('formats directional target expectations in terminal report', () => {
    const suiteResult = {
      name: 'Format Test Suite',
      totalCases: 1,
      passedCases: 1,
      hardFailureCount: 0,
      metrics: { 'entity_recall': 0.95, 'wrong_merge_rate': 0.0 },
      passed: true,
      durationMs: 10,
      results: [
        {
          caseId: 'case-1',
          domain: 'test',
          hardFailures: [],
          metrics: [
            createMetric('entity_recall', 0.95, { op: 'gte', value: 0.95 }),
            createMetric('wrong_merge_rate', 0.0, { op: 'lte', value: 0.02 }),
            createMetric('exact_metric', 1.0, { op: 'eq', value: 1.0 }),
            createMetric('legacy_metric', 0.9, 0.85),
          ],
          passed: true,
          durationMs: 10,
        },
      ],
    };

    const report = formatTerminalReport([suiteResult]);
    assert.ok(report.includes('entity_recall: 0.95 (target >= 0.95)'), 'Should format >= expectation');
    assert.ok(report.includes('wrong_merge_rate: 0 (target <= 0.02)'), 'Should format <= expectation');
    assert.ok(report.includes('exact_metric: 1 (target == 1)'), 'Should format == expectation');
  });
});
