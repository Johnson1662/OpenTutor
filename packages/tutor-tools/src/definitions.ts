import { Type, type Static, type TSchema } from 'typebox';

export const LessonGetParamsSchema = Type.Object({
  lessonId: Type.Optional(Type.String({ description: 'ID of the lesson to retrieve (defaults to active lesson if omitted)' })),
});
export type LessonGetParams = Static<typeof LessonGetParamsSchema>;

export const LessonPatchParamsSchema = Type.Object({
  lessonId: Type.String({ description: 'ID of the lesson to patch' }),
  baseVersion: Type.Number({ description: 'Current version of the lesson for optimistic concurrency check' }),
  patches: Type.Array(Type.Any(), { description: 'List of atomic patch operations to apply' }),
});
export type LessonPatchParams = Static<typeof LessonPatchParamsSchema>;

export const PathGetParamsSchema = Type.Object({
  sessionId: Type.Optional(Type.String({ description: 'ID of the learning session (defaults to active session)' })),
});
export type PathGetParams = Static<typeof PathGetParamsSchema>;

export const PathInsertDetourParamsSchema = Type.Object({
  detourKnowledgeNodeId: Type.String({ description: 'ID of the missing prerequisite knowledge node' }),
  detourTitle: Type.String({ description: 'Title of the detour node' }),
  note: Type.Optional(Type.String({ description: 'Diagnostic reason for the detour' })),
});
export type PathInsertDetourParams = Static<typeof PathInsertDetourParamsSchema>;

export const PathAdvanceParamsSchema = Type.Object({});
export type PathAdvanceParams = Static<typeof PathAdvanceParamsSchema>;

export const KnowledgeSearchParamsSchema = Type.Object({
  query: Type.String({ description: 'Search term or concept' }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: 'Max results to return (1-20, default: 5)' })),
});
export type KnowledgeSearchParams = Static<typeof KnowledgeSearchParamsSchema>;

export const ArtifactReadParamsSchema = Type.Object({
  nodeId: Type.String({ description: 'Canonical knowledge node ID' }),
});
export type ArtifactReadParams = Static<typeof ArtifactReadParamsSchema>;

export const SourceSearchParamsSchema = Type.Object({
  query: Type.String({ description: 'Search query for source chunks' }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: 'Max chunks to return (1-20, default: 3)' })),
});
export type SourceSearchParams = Static<typeof SourceSearchParamsSchema>;

export const SourceReadParamsSchema = Type.Object({
  chunkId: Type.String({ description: 'ID of the document chunk to read' }),
});
export type SourceReadParams = Static<typeof SourceReadParamsSchema>;

export const GraphNeighborsParamsSchema = Type.Object({
  nodeId: Type.String({ description: 'Canonical knowledge node ID' }),
  direction: Type.Optional(
    Type.Union([
      Type.Literal('prerequisites'),
      Type.Literal('successors'),
      Type.Literal('all'),
    ], { description: 'Direction of relations to query' })
  ),
});
export type GraphNeighborsParams = Static<typeof GraphNeighborsParamsSchema>;

export interface TutorToolDefinition<TParams extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParams;
  category: 'lesson' | 'path' | 'knowledge' | 'source';
  retrieval: boolean;
  mutation: boolean;
}

export const TUTOR_TOOL_DEFINITIONS = [
  {
    name: 'lesson_get',
    description: 'Retrieve the active Lesson and its blocks by lesson ID.',
    parameters: LessonGetParamsSchema,
    category: 'lesson',
    retrieval: true,
    mutation: false,
  },
  {
    name: 'lesson_patch',
    description: 'Apply structured block mutations (insert, replace, update, remove, move) to the current lesson canvas.',
    parameters: LessonPatchParamsSchema,
    category: 'lesson',
    retrieval: false,
    mutation: true,
  },
  {
    name: 'path_get',
    description: 'Retrieve the active Learning Path nodes, current position, and path version.',
    parameters: PathGetParamsSchema,
    category: 'path',
    retrieval: true,
    mutation: false,
  },
  {
    name: 'path_insert_detour',
    description: 'Insert a prerequisite Detour node immediately before the current active lesson node.',
    parameters: PathInsertDetourParamsSchema,
    category: 'path',
    retrieval: false,
    mutation: true,
  },
  {
    name: 'path_advance',
    description: 'Mark the current active node as completed and advance the session to the next upcoming node.',
    parameters: PathAdvanceParamsSchema,
    category: 'path',
    retrieval: false,
    mutation: true,
  },
  {
    name: 'knowledge_search',
    description: 'Search compiled Living Knowledge artifacts and claims by query keyword or concept.',
    parameters: KnowledgeSearchParamsSchema,
    category: 'knowledge',
    retrieval: true,
    mutation: false,
  },
  {
    name: 'artifact_read',
    description: 'Read the full compiled Living Knowledge Artifact for a canonical knowledge node.',
    parameters: ArtifactReadParamsSchema,
    category: 'knowledge',
    retrieval: true,
    mutation: false,
  },
  {
    name: 'source_search',
    description: 'Search raw document chunks for verbatim source evidence (Level 2 deep retrieval).',
    parameters: SourceSearchParamsSchema,
    category: 'source',
    retrieval: true,
    mutation: false,
  },
  {
    name: 'source_read',
    description: 'Read the full verbatim text and metadata of a specific source document chunk by chunk ID.',
    parameters: SourceReadParamsSchema,
    category: 'source',
    retrieval: true,
    mutation: false,
  },
  {
    name: 'graph_neighbors',
    description: 'Query knowledge graph edges (prerequisites, successors, all) around a node.',
    parameters: GraphNeighborsParamsSchema,
    category: 'knowledge',
    retrieval: true,
    mutation: false,
  },
] as const;

export type TutorToolName = (typeof TUTOR_TOOL_DEFINITIONS)[number]['name'];

export const TUTOR_TOOL_NAMES: ReadonlySet<string> = new Set(
  TUTOR_TOOL_DEFINITIONS.map((d) => d.name)
);
