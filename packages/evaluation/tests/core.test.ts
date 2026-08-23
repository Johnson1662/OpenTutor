import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  loadAllDomainBundles,
  loadDomainBundle,
  runEvalCase,
  runEvalSuite,
  assertNoForbiddenMerges,
  assertAcyclic,
  assertPrerequisiteClosure,
  calculatePrecision,
  calculateRecall,
  calculateF1,
  calculateTopologicalValidity,
  calculateGroundingScore,
  createMetric,
  formatTerminalReport,
  generateJsonReport,
  createValidator,
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

    const f1 = calculateF1(precision, recall);
    assert.equal(Number(f1.toFixed(4)), 0.6667);

    const grounding = calculateGroundingScore([true, true, false, true]);
    assert.equal(grounding, 0.75);

    const topologicalOrder = ['A', 'B', 'C'];
    const validEdges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    assert.equal(calculateTopologicalValidity(topologicalOrder, validEdges), 1.0);

    const invalidOrder = ['C', 'B', 'A'];
    assert.equal(calculateTopologicalValidity(invalidOrder, validEdges), 0.0);
  });

  it('runs eval cases and suites with report generation', async () => {
    const testCases = [
      {
        id: 'test-case-1',
        domain: 'transformer',
        input: { query: 'attention' },
        expected: { target: 'self-attention' },
      },
      {
        id: 'test-case-2',
        domain: 'transformer',
        input: { query: 'softmax' },
        expected: { target: 'softmax-normalization' },
      },
    ];

    const executor = (input: { query: string }) => {
      return { output: input.query === 'attention' ? 'self-attention' : 'softmax-normalization' };
    };

    const validator = createValidator<{ output: string }, { target: string }>(
      'TARGET_MATCH',
      (actual, expected) => {
        if (actual.output !== expected.target) {
          return [{ rule: 'TARGET_MATCH', message: `Expected ${expected.target}, got ${actual.output}` }];
        }
        return [];
      }
    );

    const suiteResult = await runEvalSuite(
      'Test Suite',
      testCases,
      executor,
      {
        validators: [validator],
        metricCalculators: [
          (actual, expected) => [createMetric('accuracy', actual.output === expected.target ? 1.0 : 0.0, 1.0)],
        ],
      }
    );

    assert.equal(suiteResult.passed, true);
    assert.equal(suiteResult.totalCases, 2);
    assert.equal(suiteResult.passedCases, 2);
    assert.equal(suiteResult.hardFailureCount, 0);
    assert.equal(suiteResult.metrics.accuracy, 1.0);

    const terminalReport = formatTerminalReport([suiteResult]);
    assert.ok(terminalReport.includes('OPENTUTOR EVALUATION REPORT'));
    assert.ok(terminalReport.includes('Test Suite'));

    const jsonReport = generateJsonReport([suiteResult]);
    const parsed = JSON.parse(jsonReport);
    assert.equal(parsed.passed, true);
    assert.equal(parsed.totalCases, 2);
  });
});
