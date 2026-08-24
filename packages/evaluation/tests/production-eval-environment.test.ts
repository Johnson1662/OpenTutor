import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenTutorModelRuntime } from '@opentutor/model-runtime';
import {
  BenchmarkTutorPolicyRunner,
  TutorEvalSuite,
  loadDomainBundle,
} from '../src/index.ts';
import { createProductionTutorEvalEnvironment } from '../src/production/production-eval-environment.ts';

test('Production evaluation environment persists valid course, lesson, session, and scoped path', async () => {
  const runtime = await createOpenTutorModelRuntime({
    dataDir: ':memory:',
    authPath: ':memory:',
    modelsPath: ':memory:',
  });
  const bundle = loadDomainBundle('transformer');
  const scenario = bundle.tutorScenarios[0]!;
  const environment = await createProductionTutorEvalEnvironment({
    bundle: {
      domain: bundle.domain,
      sourceText: bundle.sourceText,
    },
    scenario: {
      id: scenario.id,
      userMessage: scenario.userMessage,
      contextTopic: scenario.contextTopic,
    },
    modelRuntime: runtime,
    knowledgePreparation: 'fixture',
  });

  try {
    const course = environment.db.prepare('SELECT id FROM courses WHERE id = ?').get(environment.courseId) as { id: string } | undefined;
    const session = environment.db.prepare('SELECT course_id, active_lesson_id FROM learning_sessions WHERE id = ?').get(environment.sessionId) as { course_id: string; active_lesson_id: string } | undefined;
    const lesson = environment.lessonRepo.getLesson(environment.lessonId);
    assert.equal(course?.id, environment.courseId);
    assert.equal(session?.course_id, environment.courseId);
    assert.equal(session?.active_lesson_id, environment.lessonId);
    assert.equal(lesson?.courseId, environment.courseId);
    assert.equal(lesson?.id, environment.lessonId);

    const prototypeIds = new Set(environment.sessionRepo.getPath('prototype').map((node) => node.id));
    const evalIds = environment.sessionRepo.getPath(environment.sessionId).map((node) => node.id);
    assert.equal(evalIds.some((id) => prototypeIds.has(id)), false);
  } finally {
    await environment.dispose();
  }
});

test('Production evaluation retrieval tools use persisted SearchService data', async () => {
  const runtime = await createOpenTutorModelRuntime({
    dataDir: ':memory:',
    authPath: ':memory:',
    modelsPath: ':memory:',
  });
  const bundle = loadDomainBundle('transformer');
  const scenario = bundle.tutorScenarios[0]!;
  const environment = await createProductionTutorEvalEnvironment({
    bundle: {
      domain: bundle.domain,
      sourceText: bundle.sourceText,
    },
    scenario: {
      id: scenario.id,
      userMessage: scenario.userMessage,
      contextTopic: scenario.contextTopic,
    },
    modelRuntime: runtime,
    knowledgePreparation: 'fixture',
  });

  try {
    const search = await environment.toolsExecutor.executeTool(environment.sessionId, 'knowledge_search', {
      query: 'self attention',
      limit: 5,
    });
    assert.equal(search.success, true);
    if (search.success) {
      assert.ok((search.data as unknown[]).length > 0);
    }

    const lesson = environment.lessonRepo.getLesson(environment.lessonId)!;
    const artifact = await environment.toolsExecutor.executeTool(environment.sessionId, 'artifact_read', {
      nodeId: lesson.knowledgeNodeId,
    });
    assert.equal(artifact.success, true);
    if (artifact.success) {
      assert.ok(artifact.data);
    }
  } finally {
    await environment.dispose();
  }
});

test('Tutor evaluation marks expected tool failures as hard failures', async () => {
  const bundle = loadDomainBundle('transformer');
  const scenario = bundle.tutorScenarios.find((item) => item.expectedTools.includes('probe_request')) ?? {
    ...bundle.tutorScenarios[0]!,
    expectedTools: ['probe_request'],
  };
  const suite = new TutorEvalSuite({
    mode: 'contract',
    bundles: { transformer: bundle },
    policyRunner: {
      executeScenario: async () => ({
        invokedTools: ['probe_request'],
        successfulTools: [],
        toolExecutions: [{ toolName: 'probe_request', success: false }],
        responseText: 'tool failed',
        intentDetected: 'PROBE_REQUEST',
      }),
    },
  });
  const result = await suite.evaluateScenario(bundle, scenario);
  assert.equal(result.passed, false);
  assert.ok(result.hardFailures.some((failure) => failure.rule === 'EXPECTED_TOOL_EXECUTION_FAILED'));
  assert.equal(result.metrics.find((metric) => metric.name === 'expected_tool_success_rate')?.value, 0);
});

test('Production evaluation rejects BenchmarkTutorPolicyRunner', async () => {
  const bundle = loadDomainBundle('transformer');
  const suite = new TutorEvalSuite({
    mode: 'production',
    bundles: { transformer: bundle },
    policyRunner: new BenchmarkTutorPolicyRunner(),
  });
  const result = await suite.evaluateScenario(bundle, bundle.tutorScenarios[0]!);
  assert.equal(result.passed, false);
  assert.ok(result.hardFailures.some((failure) => failure.message.includes('PROHIBITED_ADAPTER')));
});

test('Production runner input excludes expected benchmark labels', async () => {
  const bundle = loadDomainBundle('transformer');
  let receivedScenario: Record<string, unknown> | undefined;
  let receivedBundle: Record<string, unknown> | undefined;
  const suite = new TutorEvalSuite({
    mode: 'production',
    bundles: { transformer: bundle },
    policyRunner: {
      executeScenario: async (scenario: any, inputBundle: any) => {
        receivedScenario = scenario;
        receivedBundle = inputBundle;
        return {
          invokedTools: ['knowledge_search'],
          successfulTools: ['knowledge_search'],
          toolExecutions: [{ toolName: 'knowledge_search', success: true }],
          responseText: 'retrieved',
          intentDetected: scenario.contextTopic,
        };
      },
    },
  });
  const scenario = {
    ...bundle.tutorScenarios[0]!,
    expectedTools: ['secret_expected_tool_marker'],
    forbiddenTools: ['secret_forbidden_tool_marker'],
    expectedIntent: 'SECRET_EXPECTED_INTENT',
  };
  const result = await suite.evaluateScenario(bundle, scenario);
  assert.equal(result.passed, false);
  assert.ok(receivedScenario);
  assert.ok(receivedBundle);
  assert.equal('expectedTools' in receivedScenario!, false);
  assert.equal('forbiddenTools' in receivedScenario!, false);
  assert.equal('expectedIntent' in receivedScenario!, false);
  assert.equal('tutorScenarios' in receivedBundle!, false);
});
