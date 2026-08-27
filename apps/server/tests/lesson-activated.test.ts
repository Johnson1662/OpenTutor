import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  LearningEvent,
  LearningPathNode,
  Lesson,
  LessonActivatedEventData,
  LessonPatchEventData,
  LessonUpdatedEventData,
  PathPatchEventData,
} from '@opentutor/protocol';
import { applyLessonPatches, applyPathPatches } from '../../web/src/runtime/patch.ts';
import { createServerContext } from '../src/index.ts';

// Web SSE reducer logic identical to LearningRoom.tsx
class SimulatedWebClientLearningState {
  lesson: Lesson | null = null;
  path: LearningPathNode[] = [];
  pathVersion = 0;
  lastSeq = 0;

  constructor(initialLesson: Lesson, initialPath: LearningPathNode[] = [], initialPathVersion = 1) {
    this.lesson = initialLesson;
    this.path = initialPath;
    this.pathVersion = initialPathVersion;
  }

  handleEvent(event: LearningEvent) {
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;

    if (event.type === 'lesson.patch') {
      const data = event.data as LessonPatchEventData;
      if (this.lesson) {
        this.lesson = applyLessonPatches(this.lesson, data.patches, data.version);
      }
    }

    if (event.type === 'lesson.updated') {
      const data = event.data as LessonUpdatedEventData;
      if (this.lesson) {
        this.lesson = { ...this.lesson, ...data.changes, version: data.version };
      }
    }

    if (event.type === 'lesson.activated') {
      const data = event.data as LessonActivatedEventData;
      this.lesson = data.lesson;
    }

    if (event.type === 'path.patch') {
      const data = event.data as PathPatchEventData;
      this.path = applyPathPatches(this.path, data.patches);
      this.pathVersion = data.version;
    }
  }
}

test('Web SSE Event Reducer - lesson.activated replaces entire Lesson object', () => {
  const mainLesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-main-1',
    courseId: 'course-transformers',
    knowledgeNodeId: 'self-attention',
    title: 'Understanding Self-Attention',
    objective: 'Master Q, K, V matrix projections',
    version: 1,
    status: 'active',
    blocks: [
      { id: 'block-1', type: 'text', variant: 'paragraph', content: 'Self-attention allows tokens to look at each other.' },
      { id: 'block-2', type: 'text', variant: 'definition', content: 'Attention is computed via QK^T / sqrt(d_k).' },
    ],
  };

  const client = new SimulatedWebClientLearningState(mainLesson);

  assert.equal(client.lesson?.id, 'lesson-main-1');
  assert.equal(client.lesson?.knowledgeNodeId, 'self-attention');
  assert.equal(client.lesson?.title, 'Understanding Self-Attention');
  assert.equal(client.lesson?.blocks.length, 2);

  // 1. Send lesson.updated (e.g. title tweak)
  const updateEvent: LearningEvent<LessonUpdatedEventData> = {
    id: 'evt-1',
    seq: 1,
    type: 'lesson.updated',
    sessionId: 'session-test',
    timestamp: new Date().toISOString(),
    data: {
      lessonId: 'lesson-main-1',
      version: 2,
      changes: {
        title: 'Deep Dive into Self-Attention',
      },
    },
  };
  client.handleEvent(updateEvent as LearningEvent);
  assert.equal(client.lesson?.version, 2);
  assert.equal(client.lesson?.title, 'Deep Dive into Self-Attention');
  assert.equal(client.lesson?.knowledgeNodeId, 'self-attention');

  // 2. Detour occurs -> lesson.activated event arrives with completely different lesson
  const detourLesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-detour-softmax',
    courseId: 'course-transformers',
    knowledgeNodeId: 'softmax-fundamentals',
    title: 'Prerequisite: Softmax Function',
    objective: 'Understand how softmax normalizes logits into probabilities',
    version: 1,
    status: 'active',
    blocks: [
      { id: 'detour-block-1', type: 'text', variant: 'paragraph', content: 'Softmax exponentiates logits and divides by sum.' },
      { id: 'detour-block-2', type: 'code', language: 'python', code: 'def softmax(x): return np.exp(x) / np.sum(np.exp(x))' },
      { id: 'detour-block-3', type: 'quiz', question: 'What is the sum of softmax output?', answerType: 'single_choice' },
    ],
  };

  const detourActivatedEvent: LearningEvent<LessonActivatedEventData> = {
    id: 'evt-2',
    seq: 2,
    type: 'lesson.activated',
    sessionId: 'session-test',
    timestamp: new Date().toISOString(),
    data: {
      lesson: detourLesson,
      previousLessonId: 'lesson-main-1',
    },
  };

  client.handleEvent(detourActivatedEvent as LearningEvent);

  // Verify that detour lesson completely replaced main lesson
  assert.equal(client.lesson?.id, 'lesson-detour-softmax');
  assert.equal(client.lesson?.knowledgeNodeId, 'softmax-fundamentals');
  assert.equal(client.lesson?.title, 'Prerequisite: Softmax Function');
  assert.equal(client.lesson?.objective, 'Understand how softmax normalizes logits into probabilities');
  assert.equal(client.lesson?.version, 1);
  assert.equal(client.lesson?.blocks.length, 3);
  assert.equal(client.lesson?.blocks[0]?.id, 'detour-block-1');
  assert.equal(client.lesson?.blocks[1]?.type, 'code');
  assert.equal(client.lesson?.blocks[2]?.type, 'quiz');

  // 3. Resume original lesson -> lesson.activated event restores main lesson
  const resumedMainLesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-main-1',
    courseId: 'course-transformers',
    knowledgeNodeId: 'self-attention',
    title: 'Understanding Self-Attention',
    objective: 'Master Q, K, V matrix projections',
    version: 3,
    status: 'active',
    blocks: [
      { id: 'block-1', type: 'text', variant: 'paragraph', content: 'Self-attention allows tokens to look at each other.' },
      { id: 'block-2', type: 'text', variant: 'definition', content: 'Attention is computed via QK^T / sqrt(d_k).' },
    ],
  };

  const resumeActivatedEvent: LearningEvent<LessonActivatedEventData> = {
    id: 'evt-3',
    seq: 3,
    type: 'lesson.activated',
    sessionId: 'session-test',
    timestamp: new Date().toISOString(),
    data: {
      lesson: resumedMainLesson,
      previousLessonId: 'lesson-detour-softmax',
    },
  };

  client.handleEvent(resumeActivatedEvent as LearningEvent);

  assert.equal(client.lesson?.id, 'lesson-main-1');
  assert.equal(client.lesson?.knowledgeNodeId, 'self-attention');
  assert.equal(client.lesson?.title, 'Understanding Self-Attention');
  assert.equal(client.lesson?.version, 3);
  assert.equal(client.lesson?.blocks.length, 2);
  assert.equal(client.lesson?.blocks[0]?.id, 'block-1');
});

test('Web SSE Event Reducer - duplicate lesson.patch replay does not duplicate a block', () => {
  const lesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-replay',
    courseId: 'course-transformers',
    knowledgeNodeId: 'self-attention',
    title: 'Self-Attention',
    version: 1,
    status: 'active',
    blocks: [{ id: 'definition', type: 'text', variant: 'paragraph', content: 'Attention' }],
  };
  const client = new SimulatedWebClientLearningState(lesson);
  const patchEvent: LearningEvent<LessonPatchEventData> = {
    id: 'evt-replay',
    seq: 1,
    type: 'lesson.patch',
    sessionId: 'session-test',
    timestamp: new Date().toISOString(),
    data: {
      lessonId: lesson.id,
      baseVersion: 1,
      version: 2,
      patches: [{
        op: 'insert',
        position: { after: 'definition' },
        block: { id: 'softmax-explanation', type: 'text', variant: 'definition', content: 'Softmax' },
      }],
    },
  };

  client.handleEvent(patchEvent);
  client.handleEvent(patchEvent);

  assert.equal(client.lesson?.version, 2);
  assert.equal(client.lesson?.blocks.filter((block) => block.id === 'softmax-explanation').length, 1);
});

test('Web SSE Event Reducer - Path SSE events maintain exactly 1 current node on Detour and Resume matching Server snapshot', async () => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, close } = await createServerContext(':memory:');

  try {
    const sessionId = 'prototype';
    const initialSnap = sessionRepo.getSessionSnapshot(sessionId)!;
    assert.ok(initialSnap);

    // Initial client state loaded from snapshot
    const client = new SimulatedWebClientLearningState(
      initialSnap.lesson,
      initialSnap.path,
      initialSnap.pathVersion
    );

    // Connect client to Server event stream
    context.eventBus.subscribe(sessionId, (event) => {
      client.handleEvent(event);
    });

    // 1. Trigger Detour via SessionService
    await context.sessionService.insertDetour(sessionId, client.pathVersion, {
      id: 'detour-softmax-node',
      knowledgeNodeId: 'softmax',
      title: 'Prerequisite: Softmax Function',
    });

    // Verify Server Snapshot
    const serverDetourSnap = sessionRepo.getSessionSnapshot(sessionId)!;

    // Verify Client SSE state matches Server Snapshot exactly
    assert.equal(client.pathVersion, serverDetourSnap.pathVersion);
    assert.equal(client.path.length, serverDetourSnap.path.length);

    // Check single current invariant on Client Path
    const clientCurrentNodes = client.path.filter((n) => n.status === 'current');
    assert.equal(clientCurrentNodes.length, 1, 'Client Path must have exactly one current node after Detour');
    assert.equal(clientCurrentNodes[0]?.knowledgeNodeId, 'softmax');
    assert.equal(client.lesson?.knowledgeNodeId, 'softmax');

    // Verify deep equivalence between Client Path and Server Path
    assert.deepEqual(
      client.path.map((n) => ({ id: n.id, status: n.status, type: n.type })),
      serverDetourSnap.path.map((n) => ({ id: n.id, status: n.status, type: n.type }))
    );

    // 2. Complete Detour & Resume Main Track
    await context.sessionService.completeCurrentNode(sessionId, client.pathVersion);

    // Verify Server Snapshot on Resume
    const serverResumeSnap = sessionRepo.getSessionSnapshot(sessionId)!;

    // Verify Client SSE state matches Server Snapshot on Resume
    assert.equal(client.pathVersion, serverResumeSnap.pathVersion);
    assert.equal(client.path.length, serverResumeSnap.path.length);

    const clientResumedCurrentNodes = client.path.filter((n) => n.status === 'current');
    assert.equal(clientResumedCurrentNodes.length, 1, 'Client Path must have exactly one current node on Resume');
    assert.equal(clientResumedCurrentNodes[0]?.knowledgeNodeId, 'self-attention');
    assert.equal(client.lesson?.knowledgeNodeId, 'self-attention');

    // Verify detour node is now completed on Client Path
    const clientDetourNode = client.path.find((n) => n.id === 'detour-softmax-node');
    assert.equal(clientDetourNode?.status, 'completed');

    assert.deepEqual(
      client.path.map((n) => ({ id: n.id, status: n.status, type: n.type })),
      serverResumeSnap.path.map((n) => ({ id: n.id, status: n.status, type: n.type }))
    );
  } finally {
    await close();
  }
});
