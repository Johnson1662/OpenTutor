import type { LessonBlock } from './lesson';

export type PatchPosition = { before: string } | { after: string } | { index: number };

export type LessonPatch =
  | { op: 'insert'; block: LessonBlock; position: PatchPosition }
  | { op: 'replace'; blockId: string; block: LessonBlock }
  | { op: 'update'; blockId: string; changes: Partial<LessonBlock> }
  | { op: 'remove'; blockId: string }
  | { op: 'move'; blockId: string; position: PatchPosition };
