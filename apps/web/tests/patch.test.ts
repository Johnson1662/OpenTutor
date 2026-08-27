import test from 'node:test';
import assert from 'node:assert/strict';
import type { LearningPathNode, Lesson } from '@opentutor/protocol';
import { applyLessonPatches, applyPathPatches } from '../src/runtime/patch.ts';
import { isNewLearningEvent } from '../src/runtime/events.ts';

const lesson: Lesson = {
  schemaVersion: '1.0',
  id: 'lesson-test',
  courseId: 'course-test',
  knowledgeNodeId: 'node-test',
  title: 'Test lesson',
  version: 2,
  status: 'active',
  blocks: [
    { id: 'a', type: 'text', variant: 'definition', content: 'A' },
    { id: 'b', type: 'code', language: 'text', code: 'B' },
  ],
};

function pathNode(id: string, position: number, status: LearningPathNode['status'] = 'upcoming'): LearningPathNode {
  return { id, knowledgeNodeId: id, title: id, type: 'main', status, position };
}

test('lesson patch reducer applies each block operation once', () => {
  const inserted = applyLessonPatches(lesson, [
    { op: 'insert', block: { id: 'c', type: 'text', variant: 'example', content: 'C' }, position: { after: 'a' } },
    { op: 'update', blockId: 'b', changes: { explanation: 'updated' } },
    { op: 'move', blockId: 'c', position: { index: 0 } },
    { op: 'remove', blockId: 'a' },
  ], 3);
  assert.deepEqual(inserted.blocks.map((block) => block.id), ['c', 'b']);
  assert.equal(inserted.blocks[1]?.type, 'code');
  assert.equal((inserted.blocks[1] as { explanation?: string }).explanation, 'updated');
  assert.equal(inserted.version, 3);
  assert.equal(applyLessonPatches(inserted, [{ op: 'remove', blockId: 'b' }], 3), inserted);
});

test('path patch reducer preserves detour order and recalculates positions', () => {
  const next = applyPathPatches(
    [pathNode('main-a', 0, 'current'), pathNode('main-b', 1)],
    [
      { op: 'update_node', nodeId: 'main-a', changes: { status: 'upcoming' } },
      { op: 'insert_node', before: 'main-a', node: pathNode('detour', 99, 'current') },
      { op: 'remove_node', nodeId: 'main-b' },
    ]
  );
  assert.deepEqual(next.map((node) => node.id), ['detour', 'main-a']);
  assert.deepEqual(next.map((node) => node.position), [0, 1]);
  assert.equal(next[0]?.type, 'main');
});

test('learning event reducer ignores replayed and out-of-order sequence numbers', () => {
  assert.equal(isNewLearningEvent(7, 8), true);
  assert.equal(isNewLearningEvent(7, 7), false);
  assert.equal(isNewLearningEvent(7, 6), false);
});
