import type { LearningPathNode, LearningPathPatch, Lesson, LessonPatch } from '@opentutor/protocol';

function findInsertIndex(ids: string[], position: { before: string } | { after: string } | { index: number }) {
  if ('index' in position) return Math.max(0, Math.min(position.index, ids.length));
  if ('before' in position) {
    const index = ids.indexOf(position.before);
    return index < 0 ? ids.length : index;
  }
  const index = ids.indexOf(position.after);
  return index < 0 ? ids.length : index + 1;
}

export function applyLessonPatches(lesson: Lesson, patches: LessonPatch[]): Lesson {
  let blocks = [...lesson.blocks];

  for (const patch of patches) {
    if (patch.op === 'insert') {
      const index = findInsertIndex(blocks.map((b) => b.id), patch.position);
      blocks.splice(index, 0, patch.block);
    } else if (patch.op === 'replace') {
      blocks = blocks.map((b) => (b.id === patch.blockId ? patch.block : b));
    } else if (patch.op === 'update') {
      blocks = blocks.map((b) => (b.id === patch.blockId ? ({ ...b, ...patch.changes } as typeof b) : b));
    } else if (patch.op === 'remove') {
      blocks = blocks.filter((b) => b.id !== patch.blockId);
    } else if (patch.op === 'move') {
      const currentIndex = blocks.findIndex((b) => b.id === patch.blockId);
      if (currentIndex >= 0) {
        const [block] = blocks.splice(currentIndex, 1);
        const index = findInsertIndex(blocks.map((b) => b.id), patch.position);
        blocks.splice(index, 0, block);
      }
    }
  }

  return { ...lesson, version: lesson.version + 1, blocks };
}

export function applyPathPatches(path: LearningPathNode[], patches: LearningPathPatch[]) {
  let next = [...path];

  for (const patch of patches) {
    if (patch.op === 'insert_node') {
      const ids = next.map((n) => n.id);
      let index = next.length;
      if (patch.before) index = Math.max(0, ids.indexOf(patch.before));
      if (patch.after) index = Math.max(0, ids.indexOf(patch.after) + 1);
      next.splice(index, 0, patch.node);
    } else if (patch.op === 'update_node') {
      next = next.map((n) => (n.id === patch.nodeId ? { ...n, ...patch.changes } : n));
    } else if (patch.op === 'remove_node') {
      next = next.filter((n) => n.id !== patch.nodeId);
    }
  }

  return next.map((node, position) => ({ ...node, position }));
}
