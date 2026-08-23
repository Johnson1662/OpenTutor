import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  LearningEvent,
  Lesson,
  LessonActivatedEventData,
  LessonPatchEventData,
  LessonUpdatedEventData,
} from '@opentutor/protocol';
import { applyLessonPatches } from '../../web/src/runtime/patch.ts';

// Web SSE reducer logic identical to LearningRoom.tsx
class SimulatedWebClientLessonState {
  lesson: Lesson | null = null;
  lastSeq = 0;

  constructor(initialLesson: Lesson) {
    this.lesson = initialLesson;
  }

  handleEvent(event: LearningEvent) {
    this.lastSeq = Math.max(this.lastSeq, event.seq);

    if (event.type === 'lesson.patch') {
      const data = event.data as LessonPatchEventData;
      if (this.lesson) {
        this.lesson = applyLessonPatches(this.lesson, data.patches);
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

  const client = new SimulatedWebClientLessonState(mainLesson);

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
