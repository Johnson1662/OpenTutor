import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  seedDatabase,
  LessonRepository,
  SessionRepository,
  KnowledgeRepository,
  EventRepository,
  VersionConflictError,
  NotFoundError,
} from '../src/index.ts';
import type { LessonPatch, LearningPathPatch, AssessmentResult } from '@opentutor/protocol';

describe('@opentutor/database', () => {
  let db: Database.Database;
  let lessonRepo: LessonRepository;
  let sessionRepo: SessionRepository;
  let knowledgeRepo: KnowledgeRepository;
  let eventRepo: EventRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    lessonRepo = new LessonRepository(db);
    sessionRepo = new SessionRepository(db);
    knowledgeRepo = new KnowledgeRepository(db);
    eventRepo = new EventRepository(db);
  });

  describe('createDatabase & seedDatabase', () => {
    it('creates in-memory database with all required tables and indexes', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      assert.ok(tableNames.includes('knowledge_nodes'));
      assert.ok(tableNames.includes('knowledge_edges'));
      assert.ok(tableNames.includes('user_knowledge_states'));
      assert.ok(tableNames.includes('courses'));
      assert.ok(tableNames.includes('course_nodes'));
      assert.ok(tableNames.includes('course_edges'));
      assert.ok(tableNames.includes('lessons'));
      assert.ok(tableNames.includes('lesson_versions'));
      assert.ok(tableNames.includes('learning_sessions'));
      assert.ok(tableNames.includes('learning_path_nodes'));
      assert.ok(tableNames.includes('assessments'));
      assert.ok(tableNames.includes('learning_events'));
    });

    it('seeds database idempotently without errors', () => {
      // Re-running seedDatabase should not throw or duplicate unique keys
      assert.doesNotThrow(() => {
        seedDatabase(db);
      });

      const lesson = lessonRepo.getLesson('lesson-self-attention');
      assert.ok(lesson);
      assert.equal(lesson.id, 'lesson-self-attention');
      assert.equal(lesson.version, 1);
      assert.equal(lesson.status, 'active');
      assert.equal(lesson.blocks.length, 4);
    });
  });

  describe('LessonRepository', () => {
    it('fetches existing lesson correctly', () => {
      const lesson = lessonRepo.getLesson('lesson-self-attention');
      assert.ok(lesson);
      assert.equal(lesson.title, 'Self Attention');
      assert.equal(lesson.knowledgeNodeId, 'self-attention');
    });

    it('returns null for non-existent lesson', () => {
      const lesson = lessonRepo.getLesson('non-existent-lesson');
      assert.equal(lesson, null);
    });

    it('applies lesson patches and increments version atomically', () => {
      const patches: LessonPatch[] = [
        {
          op: 'insert',
          block: {
            id: 'extra-example',
            type: 'text',
            variant: 'example',
            content: 'Example showing token attention weights.',
          },
          position: { after: 'definition' },
        },
      ];

      const { lesson, newVersion } = lessonRepo.applyPatches('lesson-self-attention', 1, patches);
      assert.equal(newVersion, 2);
      assert.equal(lesson.version, 2);
      assert.equal(lesson.blocks.length, 5);
      assert.equal(lesson.blocks[2].id, 'extra-example');

      // Verify persistence in db
      const persisted = lessonRepo.getLesson('lesson-self-attention');
      assert.ok(persisted);
      assert.equal(persisted.version, 2);
      assert.equal(persisted.blocks.length, 5);

      // Verify version history
      const versions = lessonRepo.getLessonVersions('lesson-self-attention');
      assert.equal(versions.length, 2);
      assert.equal(versions[0].version, 1);
      assert.equal(versions[1].version, 2);
    });

    it('rejects patch with VersionConflictError when baseVersion is stale', () => {
      // First patch advances version from 1 to 2
      lessonRepo.applyPatches('lesson-self-attention', 1, [
        {
          op: 'update',
          blockId: 'intro',
          changes: { content: 'Updated intro content' },
        },
      ]);

      // Attempting to apply another patch with stale baseVersion 1 must throw
      assert.throws(
        () => {
          lessonRepo.applyPatches('lesson-self-attention', 1, [
            {
              op: 'remove',
              blockId: 'quiz',
            },
          ]);
        },
        (err: unknown) => {
          assert.ok(err instanceof VersionConflictError);
          assert.equal(err.entityId, 'lesson-self-attention');
          assert.equal(err.expectedVersion, 1);
          assert.equal(err.actualVersion, 2);
          return true;
        }
      );
    });
  });

  describe('SessionRepository', () => {
    it('retrieves full session snapshot with lesson, path, and lastSeq', () => {
      const snapshot = sessionRepo.getSessionSnapshot('prototype');
      assert.ok(snapshot);
      assert.equal(snapshot.sessionId, 'prototype');
      assert.equal(snapshot.pathVersion, 1);
      assert.equal(snapshot.lastSeq, 0);
      assert.equal(snapshot.lesson.id, 'lesson-self-attention');
      assert.equal(snapshot.path.length, 5);
      assert.equal(snapshot.path[0].id, 'embedding');
      assert.equal(snapshot.path[0].status, 'completed');
      assert.equal(snapshot.path[1].id, 'self-attention');
      assert.equal(snapshot.path[1].status, 'current');
    });

    it('applies path patches (e.g. detour insertion) and increments pathVersion', () => {
      const patches: LearningPathPatch[] = [
        {
          op: 'insert_node',
          node: {
            id: 'detour-softmax',
            knowledgeNodeId: 'softmax-activation',
            title: 'Softmax Details',
            type: 'detour',
            status: 'current',
            position: 0,
            note: 'Inserted due to quiz difficulty',
          },
          after: 'self-attention',
        },
        {
          op: 'update_node',
          nodeId: 'self-attention',
          changes: { status: 'completed' },
        },
      ];

      const { path, newVersion } = sessionRepo.applyPathPatches('prototype', 1, patches);
      assert.equal(newVersion, 2);
      assert.equal(path.length, 6);
      assert.equal(path[1].id, 'self-attention');
      assert.equal(path[1].status, 'completed');
      assert.equal(path[2].id, 'detour-softmax');
      assert.equal(path[2].type, 'detour');
      assert.equal(path[2].position, 2);

      // Verify in fresh snapshot
      const freshSnapshot = sessionRepo.getSessionSnapshot('prototype');
      assert.ok(freshSnapshot);
      assert.equal(freshSnapshot.pathVersion, 2);
      assert.equal(freshSnapshot.path.length, 6);
    });

    it('rejects path patches with VersionConflictError when baseVersion is stale', () => {
      // Advance pathVersion from 1 to 2
      sessionRepo.applyPathPatches('prototype', 1, [
        { op: 'update_node', nodeId: 'embedding', changes: { status: 'completed' } },
      ]);

      // Attempting to patch with stale baseVersion 1 must fail
      assert.throws(
        () => {
          sessionRepo.applyPathPatches('prototype', 1, [
            { op: 'remove_node', nodeId: 'gpt' },
          ]);
        },
        (err: unknown) => {
          assert.ok(err instanceof VersionConflictError);
          assert.equal(err.entityId, 'prototype');
          assert.equal(err.expectedVersion, 1);
          assert.equal(err.actualVersion, 2);
          return true;
        }
      );
    });
  });

  describe('KnowledgeRepository', () => {
    it('records assessment and updates user knowledge state to mastered on correct answer', () => {
      const assessment: AssessmentResult = {
        id: 'asmt-1',
        knowledgeNodeId: 'self-attention',
        lessonId: 'lesson-self-attention',
        blockId: 'quiz',
        result: 'correct',
        confidence: 0.88,
        feedback: 'Great job understanding self-attention.',
      };

      knowledgeRepo.recordAssessment(assessment, 'default-user');

      const state = knowledgeRepo.getUserKnowledgeState('default-user', 'self-attention');
      assert.ok(state);
      assert.equal(state.knowledgeNodeId, 'self-attention');
      assert.equal(state.status, 'mastered');
      assert.equal(state.confidence, 0.88);

      const assessments = knowledgeRepo.getAssessments('default-user', 'lesson-self-attention');
      assert.equal(assessments.length, 1);
      assert.equal(assessments[0].result, 'correct');
    });

    it('updates user knowledge state to weak on incorrect answer', () => {
      const assessment: AssessmentResult = {
        id: 'asmt-2',
        knowledgeNodeId: 'multi-head',
        lessonId: 'lesson-multi-head',
        result: 'incorrect',
        confidence: 0.2,
        feedback: 'Review the multi-head attention concept.',
      };

      knowledgeRepo.recordAssessment(assessment, 'default-user');

      const state = knowledgeRepo.getUserKnowledgeState('default-user', 'multi-head');
      assert.ok(state);
      assert.equal(state.status, 'weak');
      assert.equal(state.confidence, 0.2);
    });
  });

  describe('EventRepository', () => {
    it('appends events with strictly monotonic sequence numbers starting from 1', () => {
      const event1 = eventRepo.appendEvent('prototype', 'agent.started', { requestId: 'req-1' });
      assert.equal(event1.seq, 1);
      assert.equal(event1.type, 'agent.started');
      assert.equal(event1.sessionId, 'prototype');

      const event2 = eventRepo.appendEvent('prototype', 'lesson.patch', {
        lessonId: 'lesson-self-attention',
        version: 2,
      });
      assert.equal(event2.seq, 2);

      const event3 = eventRepo.appendEvent('prototype', 'agent.completed', {
        requestId: 'req-1',
        message: 'Done',
      });
      assert.equal(event3.seq, 3);

      assert.equal(eventRepo.getLastSeq('prototype'), 3);
    });

    it('retrieves events since specified sequence number', () => {
      eventRepo.appendEvent('prototype', 'agent.started', { requestId: 'req-1' });
      eventRepo.appendEvent('prototype', 'lesson.patch', { version: 2 });
      eventRepo.appendEvent('prototype', 'agent.completed', { requestId: 'req-1' });

      const since1 = eventRepo.getEventsSince('prototype', 1);
      assert.equal(since1.length, 2);
      assert.equal(since1[0].seq, 2);
      assert.equal(since1[1].seq, 3);

      const since2 = eventRepo.getEventsSince('prototype', 2);
      assert.equal(since2.length, 1);
      assert.equal(since2[0].seq, 3);

      const since3 = eventRepo.getEventsSince('prototype', 3);
      assert.equal(since3.length, 0);
    });

    it('isolates sequence numbers per session', () => {
      const s1e1 = eventRepo.appendEvent('session-1', 'agent.started', {});
      const s2e1 = eventRepo.appendEvent('session-2', 'agent.started', {});
      const s1e2 = eventRepo.appendEvent('session-1', 'agent.completed', {});

      assert.equal(s1e1.seq, 1);
      assert.equal(s2e1.seq, 1);
      assert.equal(s1e2.seq, 2);
    });
  });
});
