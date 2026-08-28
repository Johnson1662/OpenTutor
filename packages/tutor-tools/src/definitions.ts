import { Type, type Static, type TSchema } from 'typebox';

export const LessonGetParamsSchema = Type.Object({
  lessonId: Type.Optional(Type.String({ description: 'ID of the lesson to retrieve (defaults to active lesson if omitted)' })),
});
export type LessonGetParams = Static<typeof LessonGetParamsSchema>;

export const TextBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('text'),
  variant: Type.Optional(
    Type.Union([
      Type.Literal('paragraph'),
      Type.Literal('definition'),
      Type.Literal('example'),
      Type.Literal('callout'),
      Type.Literal('summary'),
    ])
  ),
  content: Type.String(),
  knowledgeNodeIds: Type.Optional(Type.Array(Type.String())),
  state: Type.Optional(
    Type.Union([
      Type.Literal('normal'),
      Type.Literal('loading'),
      Type.Literal('error'),
    ])
  ),
});

export const CodeBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('code'),
  language: Type.String(),
  code: Type.String(),
  explanation: Type.Optional(Type.String()),
  knowledgeNodeIds: Type.Optional(Type.Array(Type.String())),
  state: Type.Optional(
    Type.Union([
      Type.Literal('normal'),
      Type.Literal('loading'),
      Type.Literal('error'),
    ])
  ),
});

export const DiagramBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('diagram'),
  diagramType: Type.Union([
    Type.Literal('flow'),
    Type.Literal('relationship'),
    Type.Literal('sequence'),
  ]),
  nodes: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
  edges: Type.Array(
    Type.Object({
      from: Type.String(),
      to: Type.String(),
      label: Type.Optional(Type.String()),
    })
  ),
  knowledgeNodeIds: Type.Optional(Type.Array(Type.String())),
  state: Type.Optional(
    Type.Union([
      Type.Literal('normal'),
      Type.Literal('loading'),
      Type.Literal('error'),
    ])
  ),
});

export const QuizOptionSchema = Type.Object({
  id: Type.String(),
  text: Type.String(),
});

export const QuizBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('quiz'),
  question: Type.String(),
  answerType: Type.Optional(
    Type.Union([
      Type.Literal('text'),
      Type.Literal('single_choice'),
      Type.Literal('multiple_choice'),
    ])
  ),
  options: Type.Optional(Type.Array(QuizOptionSchema)),
  answerSpec: Type.Optional(
    Type.Union([
      Type.Object({
        type: Type.Literal('single_choice'),
        correctOptionId: Type.String(),
      }),
      Type.Object({
        type: Type.Literal('multiple_choice'),
        correctOptionIds: Type.Array(Type.String()),
      }),
      Type.Object({
        type: Type.Literal('open'),
        rubric: Type.Object({
          concepts: Type.Array(Type.String()),
          referenceAnswer: Type.Optional(Type.String()),
        }),
      }),
    ])
  ),
  knowledgeNodeIds: Type.Optional(Type.Array(Type.String())),
  state: Type.Optional(
    Type.Union([
      Type.Literal('normal'),
      Type.Literal('loading'),
      Type.Literal('error'),
    ])
  ),
});

export const LessonBlockSchema = Type.Union([
  TextBlockSchema,
  CodeBlockSchema,
  DiagramBlockSchema,
  QuizBlockSchema,
]);

export const PatchPositionSchema = Type.Union([
  Type.Object({ before: Type.String() }),
  Type.Object({ after: Type.String() }),
  Type.Object({ index: Type.Number() }),
]);

export const LessonPatchSchema = Type.Union([
  Type.Object({
    op: Type.Literal('insert'),
    block: LessonBlockSchema,
    position: PatchPositionSchema,
  }),
  Type.Object({
    op: Type.Literal('replace'),
    blockId: Type.String(),
    block: LessonBlockSchema,
  }),
  Type.Object({
    op: Type.Literal('update'),
    blockId: Type.String(),
    changes: Type.Record(Type.String(), Type.Any()),
  }),
  Type.Object({
    op: Type.Literal('remove'),
    blockId: Type.String(),
  }),
  Type.Object({
    op: Type.Literal('move'),
    blockId: Type.String(),
    position: PatchPositionSchema,
  }),
]);

export const LessonPatchParamsSchema = Type.Object({
  lessonId: Type.String({ description: 'ID of the lesson to patch' }),
  baseVersion: Type.Number({ description: 'Current version of the lesson for optimistic concurrency check' }),
  patches: Type.Array(LessonPatchSchema, { description: 'List of atomic patch operations to apply' }),
});
export type LessonPatchParams = Static<typeof LessonPatchParamsSchema>;
export type LessonPatch = Static<typeof LessonPatchSchema>;
export type LessonBlock = Static<typeof LessonBlockSchema>;
export type PatchPosition = Static<typeof PatchPositionSchema>;

export const PathGetParamsSchema = Type.Object({
  sessionId: Type.Optional(Type.String({ description: 'ID of the learning session (defaults to active session)' })),
});
export type PathGetParams = Static<typeof PathGetParamsSchema>;

export const PathInsertDetourParamsSchema = Type.Object({
  nodeId: Type.String({ description: 'Knowledge node ID to detour into' }),
  diagnosisId: Type.String({ description: 'ID of the confirmed diagnosis authorizing this detour' }),
  detourKnowledgeNodeId: Type.Optional(Type.String({ description: 'ID of the missing prerequisite knowledge node' })),
  detourTitle: Type.Optional(Type.String({ description: 'Title of the detour node' })),
  note: Type.Optional(Type.String({ description: 'Diagnostic reason for the detour' })),
});
export type PathInsertDetourParams = Static<typeof PathInsertDetourParamsSchema>;

export const ProbeRequestParamsSchema = Type.Object({
  prerequisiteNodeId: Type.Optional(Type.String({ description: 'Specific prerequisite knowledge node to probe' })),
  reason: Type.Optional(Type.String({ description: 'Pedagogical reason for diagnostic probe' })),
});
export type ProbeRequestParams = Static<typeof ProbeRequestParamsSchema>;

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
  retrievalCost: number;
  mutation: boolean;
}

export const TUTOR_TOOL_DEFINITIONS = [
  {
    name: 'lesson_get',
    description: 'Retrieve the active Lesson and its blocks by lesson ID.',
    parameters: LessonGetParamsSchema,
    category: 'lesson',
    retrieval: false,
    retrievalCost: 0,
    mutation: false,
  },
  {
    name: 'lesson_patch',
    description: 'Apply structured block mutations (insert, replace, update, remove, move) to the current lesson canvas.',
    parameters: LessonPatchParamsSchema,
    category: 'lesson',
    retrieval: false,
    retrievalCost: 0,
    mutation: true,
  },
  {
    name: 'probe_request',
    description: 'Request a diagnostic probe to be generated and placed on the Lesson Canvas to assess learner understanding of a prerequisite.',
    parameters: ProbeRequestParamsSchema,
    category: 'lesson',
    retrieval: false,
    retrievalCost: 0,
    mutation: true,
  },
  {
    name: 'path_get',
    description: 'Retrieve the active Learning Path nodes, current position, and path version.',
    parameters: PathGetParamsSchema,
    category: 'path',
    retrieval: false,
    retrievalCost: 0,
    mutation: false,
  },
  {
    name: 'path_insert_detour',
    description: 'Insert a prerequisite Detour node immediately before the current active lesson node.',
    parameters: PathInsertDetourParamsSchema,
    category: 'path',
    retrieval: false,
    retrievalCost: 0,
    mutation: true,
  },
  {
    name: 'knowledge_search',
    description: 'Search compiled Living Knowledge artifacts and claims by query keyword or concept.',
    parameters: KnowledgeSearchParamsSchema,
    category: 'knowledge',
    retrieval: true,
    retrievalCost: 1,
    mutation: false,
  },
  {
    name: 'artifact_read',
    description: 'Read the full compiled Living Knowledge Artifact for a canonical knowledge node.',
    parameters: ArtifactReadParamsSchema,
    category: 'knowledge',
    retrieval: true,
    retrievalCost: 1,
    mutation: false,
  },
  {
    name: 'source_search',
    description: 'Search raw document chunks for verbatim source evidence (Level 2 deep retrieval).',
    parameters: SourceSearchParamsSchema,
    category: 'source',
    retrieval: true,
    retrievalCost: 1,
    mutation: false,
  },
  {
    name: 'source_read',
    description: 'Read the full verbatim text and metadata of a specific source document chunk by chunk ID.',
    parameters: SourceReadParamsSchema,
    category: 'source',
    retrieval: true,
    retrievalCost: 1,
    mutation: false,
  },
  {
    name: 'graph_neighbors',
    description: 'Query knowledge graph edges (prerequisites, successors, all) around a node.',
    parameters: GraphNeighborsParamsSchema,
    category: 'knowledge',
    retrieval: true,
    retrievalCost: 1,
    mutation: false,
  },
] as const;

export type TutorToolName = (typeof TUTOR_TOOL_DEFINITIONS)[number]['name'];

export const TUTOR_TOOL_NAMES: ReadonlySet<string> = new Set(
  TUTOR_TOOL_DEFINITIONS.map((d) => d.name)
);
