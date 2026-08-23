import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase,
  seedDatabase,
  runMigrations,
  ALL_MIGRATIONS,
  LessonRepository,
  SessionRepository,
  DuplicateBlockIdError,
  EmptyPatchError,
  TargetNotFoundError,
  ImmutablePropertyError,
  VersionConflictError,
  DEFAULT_SESSION_ID,
} from '../src/index.ts';
import type { LessonPatch } from '@opentutor/protocol';

test('packages/database - Migration Runner & Strict Domain Invariants', async (t) => {
  const db = createDatabase(':memory:');
  seedDatabase(db);

  const lessonRepo = new LessonRepository(db);
  const sessionRepo = new SessionRepository(db);

  await t.test('1. Migration runner is idempotent', () => {
    const appliedAgain = runMigrations(db, ALL_MIGRATIONS);
    assert.equal(appliedAgain, 0);
  });

  await t.test('2. LessonPatch rejects empty patches', () => {
    assert.throws(
      () => lessonRepo.applyPatches('lesson-self-attention', 1, []),
      EmptyPatchError
    );
  });

  await t.test('3. LessonPatch rejects duplicate block IDs on insert', () => {
    const duplicatePatch: LessonPatch = {
      op: 'insert',
      position: { index: 0 },
      block: {
        id: 'intro', // Already exists in seed
        type: 'text',
        variant: 'paragraph',
        content: 'Duplicate!',
      },
    };

    assert.throws(
      () => lessonRepo.applyPatches('lesson-self-attention', 1, [duplicatePatch]),
      DuplicateBlockIdError
    );
  });

  await t.test('4. LessonPatch rejects non-existent positional targets', () => {
    const targetPatch: LessonPatch = {
      op: 'insert',
      position: { after: 'non-existent-block-id' },
      block: {
        id: 'new-block-1',
        type: 'text',
        variant: 'paragraph',
        content: 'Valid content',
      },
    };

    assert.throws(
      () => lessonRepo.applyPatches('lesson-self-attention', 1, [targetPatch]),
      TargetNotFoundError
    );
  });

  await t.test('5. LessonPatch rejects mutation of block id or type', () => {
    const mutateIdPatch: LessonPatch = {
      op: 'update',
      blockId: 'intro',
      changes: { id: 'mutated-intro' as any },
    };

    assert.throws(
      () => lessonRepo.applyPatches('lesson-self-attention', 1, [mutateIdPatch]),
      ImmutablePropertyError
    );
  });

  await t.test('6. LearningPath enforces strict single-current invariant during insertDetour', () => {
    const snapshotBefore = sessionRepo.getSessionSnapshot(DEFAULT_SESSION_ID);
    assert.ok(snapshotBefore);
    const activeNodeBefore = snapshotBefore.path.find((n) => n.status === 'current');
    assert.ok(activeNodeBefore);
    assert.equal(activeNodeBefore.knowledgeNodeId, 'self-attention');

    // Insert detour before active node
    const detourResult = sessionRepo.insertDetour(DEFAULT_SESSION_ID, snapshotBefore.pathVersion, {
      id: 'detour-softmax-test',
      knowledgeNodeId: 'softmax',
      title: 'Detour: Softmax Normalization',
      note: 'Prerequisite gap',
    });

    const currentNodes = detourResult.path.filter((n) => n.status === 'current');
    assert.equal(currentNodes.length, 1, 'Exactly one node must be current');
    assert.equal(currentNodes[0].id, 'detour-softmax-test');

    // Original active node should now be upcoming
    const prevNode = detourResult.path.find((n) => n.id === activeNodeBefore.id);
    assert.ok(prevNode);
    assert.equal(prevNode.status, 'upcoming');
  });

  await t.test('7. LearningPath completeCurrentNode advances cleanly back to main track', () => {
    const pathVersion = sessionRepo.getPathVersion(DEFAULT_SESSION_ID);
    const completedResult = sessionRepo.completeCurrentNode(DEFAULT_SESSION_ID, pathVersion);

    const currentNodes = completedResult.path.filter((n) => n.status === 'current');
    assert.equal(currentNodes.length, 1, 'Exactly one node must be current');
    assert.equal(currentNodes[0].knowledgeNodeId, 'self-attention', 'Should resume Self Attention main node');

    const detourNode = completedResult.path.find((n) => n.id === 'detour-softmax-test');
    assert.ok(detourNode);
    assert.equal(detourNode.status, 'completed');
  });
});
