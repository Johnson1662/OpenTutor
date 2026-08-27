import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KnowledgeEvalSuite,
  CourseEvalSuite,
  LessonEvalSuite,
  TutorEvalSuite,
  LearnerEvalSuite,
  runCli,
  loadAllDomainBundles,
  loadDomainBundle,
} from '../src/index.ts';

test('Benchmark Fixtures load accurately for 3 domains', () => {
  const bundles = loadAllDomainBundles();
  assert.ok(bundles.transformer, 'Transformer domain bundle must exist');
  assert.ok(bundles.csapp, 'CSAPP domain bundle must exist');
  assert.ok(bundles.cpp, 'C++ domain bundle must exist');

  for (const domain of ['transformer', 'csapp', 'cpp']) {
    const b = bundles[domain];
    assert.ok(b.sourceText.length > 50, `${domain} source text must be non-empty`);
    assert.ok(b.knowledge.entities.length >= 6, `${domain} must have at least 6 knowledge entities`);
    assert.ok(b.aliases.length >= 3, `${domain} must have alias groups`);
    assert.ok(b.forbiddenMerges.length >= 2, `${domain} must have forbidden merges`);
    assert.ok(b.relations.length >= 4, `${domain} must have prerequisite relations`);
    assert.ok(b.courseCases.length >= 2, `${domain} must have course cases`);
    assert.ok(b.lessonCases.length >= 2, `${domain} must have lesson cases`);
    assert.ok(b.tutorScenarios.length >= 3, `${domain} must have tutor scenarios`);
  }
});

test('KnowledgeEvalSuite runs deterministically across all domains and passes thresholds', async () => {
  const suite = new KnowledgeEvalSuite();
  const result = await suite.runSuite('all');

  assert.equal(result.totalCases, 3, 'Should evaluate 3 domain cases');
  assert.equal(result.hardFailureCount, 0, `Should have 0 hard failures, got: ${JSON.stringify(result.results.flatMap((r) => r.hardFailures))}`);
  assert.equal(result.passedCases, 3, 'All 3 domain cases must pass');
  assert.equal(result.passed, true, 'Knowledge suite must pass overall');

  // Verify metric averages
  assert.ok(result.metrics.entity_recall >= 0.95, `Entity recall ${result.metrics.entity_recall} must be >= 0.95`);
  assert.ok(result.metrics.entity_precision >= 0.80, `Entity precision ${result.metrics.entity_precision} must be >= 0.80`);
  assert.ok(result.metrics.alias_merge_recall >= 0.95, `Alias merge recall ${result.metrics.alias_merge_recall} must be >= 0.95`);
  assert.equal(result.metrics.wrong_merge_rate, 0, 'Wrong merge rate must be 0');
  assert.equal(result.metrics.claim_grounding_rate, 1.0, 'Claim grounding rate must be 1.0');
  assert.ok(result.metrics.relation_validity >= 0.90, `Relation validity ${result.metrics.relation_validity} must be >= 0.90`);
  assert.ok(result.metrics.artifact_support_rate >= 0.90, `Artifact support rate ${result.metrics.artifact_support_rate} must be >= 0.90`);
});

test('CourseEvalSuite evaluates prerequisite closure, topological ordering, and cycle freedom', async () => {
  const suite = new CourseEvalSuite();
  const result = await suite.runSuite('all');

  assert.ok(result.totalCases >= 8, `Expected at least 8 course cases across domains, got ${result.totalCases}`);
  assert.equal(result.hardFailureCount, 0, `Course suite hard failures: ${JSON.stringify(result.results.flatMap((r) => r.hardFailures))}`);
  assert.equal(result.passedCases, result.totalCases, 'All course cases must pass');
  assert.equal(result.passed, true, 'Course suite must pass overall');

  assert.ok(result.metrics.target_concept_coverage >= 0.95, `Target coverage must be >= 0.95`);
  assert.equal(result.metrics.prerequisite_closure_rate, 1.0, 'Prerequisite closure rate must be 1.0');
  assert.equal(result.metrics.topological_ordering_validity, 1.0, 'Topological validity must be 1.0');
  assert.equal(result.metrics.forbidden_node_rate, 0.0, 'Forbidden node rate must be 0.0');
  assert.equal(result.metrics.graph_cycle_count, 1.0, 'Graph cycle score must be 1.0 (zero cycles)');
});

test('LessonEvalSuite validates lesson structure, active grounding, and quiz alignment', async () => {
  const suite = new LessonEvalSuite();
  const result = await suite.runSuite('all');

  assert.ok(result.totalCases >= 8, `Expected at least 8 lesson cases across domains, got ${result.totalCases}`);
  assert.equal(result.hardFailureCount, 0, `Lesson suite hard failures: ${JSON.stringify(result.results.flatMap((r) => r.hardFailures))}`);
  assert.equal(result.passedCases, result.totalCases, 'All lesson cases must pass');
  assert.equal(result.passed, true, 'Lesson suite must pass overall');

  assert.equal(result.metrics.lesson_structure_score, 1.0, 'Lesson structure score must be 1.0');
  assert.equal(result.metrics.lesson_grounding_rate, 1.0, 'Lesson grounding rate must be 1.0');
  assert.ok(result.metrics.quiz_alignment_rate >= 0.95, `Quiz alignment rate must be >= 0.95`);
  assert.ok(result.metrics.concept_coverage_rate >= 0.95, `Concept coverage rate must be >= 0.95`);
});

test('TutorEvalSuite simulates learner interaction scenarios and tool invocation constraints', async () => {
  const suite = new TutorEvalSuite();
  const result = await suite.runSuite('all');

  assert.ok(result.totalCases >= 10, `Expected at least 10 tutor scenarios across domains, got ${result.totalCases}`);
  assert.equal(result.hardFailureCount, 0, `Tutor suite hard failures: ${JSON.stringify(result.results.flatMap((r) => r.hardFailures))}`);
  assert.equal(result.passedCases, result.totalCases, 'All tutor scenarios must pass');
  assert.equal(result.passed, true, 'Tutor suite must pass overall');

  assert.equal(result.metrics.wrong_tool_rate, 0.0, 'Wrong tool rate must be 0.0');
  assert.equal(result.metrics.expected_tool_recall, 1.0, 'Expected tool recall must be 1.0');
  assert.equal(result.metrics.unnecessary_retrieval_rate, 0.0, 'Unnecessary retrieval rate must be 0.0');
  assert.equal(result.metrics.unnecessary_detour_rate, 0.0, 'Unnecessary detour rate must be 0.0');
  assert.equal(result.metrics.unauthorized_detour_rate, 0.0, 'Unauthorized detour rate must be 0.0');
  assert.equal(result.metrics.chat_dump_rate, 0.0, 'Chat dump rate must be 0.0');
});

test('LearnerEvalSuite verifies one-answer impossibility, determinism, decay, and threshold consistency', async () => {
  const suite = new LearnerEvalSuite();
  const result = await suite.runSuite('all');

  assert.equal(result.totalCases, 3, 'Should evaluate 3 domain cases');
  assert.equal(result.hardFailureCount, 0, `Learner suite hard failures: ${JSON.stringify(result.results.flatMap((r) => r.hardFailures))}`);
  assert.equal(result.passedCases, 3, 'All 3 domain cases must pass');
  assert.equal(result.passed, true, 'Learner suite must pass overall');

  assert.equal(result.metrics['same-item-spam-never-mastered'], 1.0, 'same-item-spam-never-mastered must be 1.0');
  assert.equal(result.metrics['incorrect-evidence-lowers-mastery'], 1.0, 'incorrect-evidence-lowers-mastery must be 1.0');
  assert.equal(result.metrics['mastery-history-replay-equals-persisted'], 1.0, 'mastery-history-replay-equals-persisted must be 1.0');
  assert.equal(result.metrics['two-plus-independent-items-required'], 1.0, 'two-plus-independent-items-required must be 1.0');
  assert.equal(result.metrics['probe-evidence-targets-prerequisite-node'], 1.0, 'probe-evidence-targets-prerequisite-node must be 1.0');
  assert.equal(result.metrics.OneAnswerMasteryImpossibleRate, 1.0, 'One answer mastery impossible rate must be 1.0');
  assert.equal(result.metrics.EvidenceAggregationDeterminism, 1.0, 'Evidence aggregation determinism must be 1.0');
  assert.equal(result.metrics.DecayMonotonicity, 1.0, 'Decay monotonicity must be 1.0');
  assert.equal(result.metrics.ThresholdConsistency, 1.0, 'Threshold consistency must be 1.0');
});

test('CLI runner executes suites and generates eval-report.json output', async () => {
  const testReportPath = path.resolve(process.cwd(), 'temp-test-report.json');
  try {
    const exitCode = await runCli(['--suite', 'all', '--domain', 'transformer', '--out', testReportPath]);
    assert.equal(exitCode, 0, 'CLI exit code should be 0 for passing evaluation');
    assert.ok(fs.existsSync(testReportPath), 'Report file should be created');

    const reportContent = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.equal(reportContent.passed, true, 'Report should indicate passed');
    assert.equal(reportContent.totalSuites, 5, 'Report should contain 5 suites');
  } finally {
    if (fs.existsSync(testReportPath)) {
      fs.unlinkSync(testReportPath);
    }
  }
});

test('Production mode without model credentials exits with MODEL_SETUP_REQUIRED', async () => {
  const previousDataDir = process.env.OPENTUTOR_DATA_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.OPENTUTOR_DATA_DIR = ':memory:';
  process.env.PI_OFFLINE = '1';
  try {
    const exitCode = await runCli(['--mode', 'production', '--suite', 'knowledge', '--domain', 'transformer']);
    assert.equal(exitCode, 1, 'Production mode without configured live models should exit with 1 (MODEL_SETUP_REQUIRED)');
  } finally {
    if (previousDataDir === undefined) delete process.env.OPENTUTOR_DATA_DIR;
    else process.env.OPENTUTOR_DATA_DIR = previousDataDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
  }
});
