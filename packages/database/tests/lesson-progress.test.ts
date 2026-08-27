import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  seedDatabase,
  LessonProgressRepository,
  SessionRepository,
  ProgressStateConflictError,
  VersionConflictError,
} from '../src/index.ts';

describe('LessonProgressRepository', () => {
  let db: Database.Database;
  let progressRepo: LessonProgressRepository;
  let sessionRepo: SessionRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    progressRepo = new LessonProgressRepository(db);
    sessionRepo = new SessionRepository(db, progressRepo);
  });

  it('creates the first active block once and returns the persisted row', () => {
    const first = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b']);
    const again = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b']);

    assert.equal(first.activeBlockId, 'a');
    assert.deepEqual(first.completedBlockIds, []);
    assert.equal(first.version, 1);
    assert.deepEqual(again, first);
  });

  it('activates an inserted probe without discarding completed blocks', () => {
    const initial = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b']);
    const afterA = progressRepo.advance('prototype', 'lesson-self-attention', initial.version, 'a', ['a', 'b']);
    const activated = progressRepo.activate('prototype', 'lesson-self-attention', 'probe');

    assert.equal(activated.activeBlockId, 'probe');
    assert.deepEqual(activated.completedBlockIds, ['a']);
    assert.equal(activated.version, afterA.progress.version + 1);
    assert.deepEqual(progressRepo.activate('prototype', 'lesson-self-attention', 'probe'), activated);
  });

  it('advances one block, persists completion, and rejects a second final advance', () => {
    const initial = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b', 'c']);
    const afterA = progressRepo.advance('prototype', 'lesson-self-attention', initial.version, 'a', ['a', 'b', 'c']);
    const afterB = progressRepo.advance('prototype', 'lesson-self-attention', afterA.progress.version, 'b', ['a', 'b', 'c']);
    const afterC = progressRepo.advance('prototype', 'lesson-self-attention', afterB.progress.version, 'c', ['a', 'b', 'c']);

    assert.equal(afterC.completed, true);
    assert.equal(afterC.progress.activeBlockId, null);
    assert.deepEqual(afterC.progress.completedBlockIds, ['a', 'b', 'c']);
    assert.deepEqual(progressRepo.get('prototype', 'lesson-self-attention'), afterC.progress);
    assert.throws(
      () => progressRepo.advance('prototype', 'lesson-self-attention', afterC.progress.version, null, ['a', 'b', 'c']),
      (error: unknown) => error instanceof ProgressStateConflictError
    );
  });

  it('enforces optimistic version and active-block conflicts', () => {
    const initial = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b']);
    const next = progressRepo.advance('prototype', 'lesson-self-attention', initial.version, 'a', ['a', 'b']);

    assert.throws(
      () => progressRepo.advance('prototype', 'lesson-self-attention', initial.version, 'a', ['a', 'b']),
      (error: unknown) => error instanceof VersionConflictError
    );
    assert.throws(
      () => progressRepo.advance('prototype', 'lesson-self-attention', next.progress.version, 'a', ['a', 'b']),
      (error: unknown) => error instanceof ProgressStateConflictError
    );
  });

  it('isolates progress by both session and lesson', () => {
    sessionRepo.createSession({
      id: 'session-b',
      userId: 'user-b',
      courseId: 'transformer',
      activeLessonId: 'lesson-self-attention',
      path: [],
    });

    const sessionA = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b']);
    const sessionB = progressRepo.getOrCreate('session-b', 'lesson-self-attention', ['a', 'b']);
    const otherLesson = progressRepo.getOrCreate('prototype', 'lesson-softmax', ['a', 'b']);
    progressRepo.advance('prototype', 'lesson-self-attention', sessionA.version, 'a', ['a', 'b']);

    assert.equal(progressRepo.get('session-b', 'lesson-self-attention')?.activeBlockId, sessionB.activeBlockId);
    assert.equal(progressRepo.get('prototype', 'lesson-softmax')?.activeBlockId, otherLesson.activeBlockId);
    assert.equal(progressRepo.get('prototype', 'lesson-self-attention')?.activeBlockId, 'b');
  });

  it('reconciles completed IDs and selects the next surviving block after a patch', () => {
    const initial = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b', 'c']);
    const afterA = progressRepo.advance('prototype', 'lesson-self-attention', initial.version, 'a', ['a', 'b', 'c']);
    const reconciled = progressRepo.reconcile('prototype', 'lesson-self-attention', ['a', 'c']);

    assert.deepEqual(reconciled.completedBlockIds, ['a']);
    assert.equal(reconciled.activeBlockId, 'c');
    assert.equal(reconciled.version, afterA.progress.version + 1);
  });

  it('restarts at the first block with a new version', () => {
    const initial = progressRepo.getOrCreate('prototype', 'lesson-self-attention', ['a', 'b']);
    const advanced = progressRepo.advance('prototype', 'lesson-self-attention', initial.version, 'a', ['a', 'b']);
    const restarted = progressRepo.restart(
      'prototype',
      'lesson-self-attention',
      advanced.progress.version,
      ['a', 'b'],
      advanced.progress.activeBlockId
    );

    assert.equal(restarted.progress.activeBlockId, 'a');
    assert.deepEqual(restarted.progress.completedBlockIds, []);
    assert.equal(restarted.progress.version, advanced.progress.version + 1);
  });

  it('supports an empty lesson row without inventing an active block', () => {
    const empty = progressRepo.getOrCreate('prototype', 'lesson-self-attention', []);
    const advanced = progressRepo.advance('prototype', 'lesson-self-attention', empty.version, null, []);

    assert.equal(empty.activeBlockId, null);
    assert.equal(empty.completedBlockIds.length, 0);
    assert.equal(advanced.completed, true);
    assert.equal(advanced.progress.activeBlockId, null);
  });
});
