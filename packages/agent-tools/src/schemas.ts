export const TUTOR_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lesson_get',
      description: 'Retrieve the active Lesson and its blocks by lesson ID.',
      parameters: {
        type: 'object',
        properties: {
          lessonId: { type: 'string', description: 'ID of the lesson to retrieve' },
        },
        required: ['lessonId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lesson_patch',
      description: 'Apply structured block mutations (insert, replace, update, remove, move) to the current lesson canvas.',
      parameters: {
        type: 'object',
        properties: {
          lessonId: { type: 'string', description: 'ID of the lesson to patch' },
          baseVersion: { type: 'number', description: 'Current version of the lesson for optimistic concurrency check' },
          patches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['insert', 'replace', 'update', 'remove', 'move'] },
                blockId: { type: 'string' },
                block: { type: 'object' },
                position: { type: 'object' },
                changes: { type: 'object' },
              },
              required: ['op'],
            },
            description: 'List of atomic patch operations to apply',
          },
        },
        required: ['lessonId', 'baseVersion', 'patches'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'path_get',
      description: 'Retrieve the active Learning Path nodes, current position, and path version.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID of the learning session' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'path_insert_detour',
      description: 'Insert a prerequisite Detour node immediately before the current active lesson node.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID of the active session' },
          baseVersion: { type: 'number', description: 'Current path version' },
          knowledgeNodeId: { type: 'string', description: 'ID of the missing prerequisite knowledge node' },
          title: { type: 'string', description: 'Title of the detour node' },
          note: { type: 'string', description: 'Diagnostic reason for the detour' },
        },
        required: ['sessionId', 'baseVersion', 'knowledgeNodeId', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'path_advance',
      description: 'Mark the current active node as completed and advance the session to the next upcoming node.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID of the active session' },
          baseVersion: { type: 'number', description: 'Current path version' },
        },
        required: ['sessionId', 'baseVersion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_search',
      description: 'Search compiled Living Knowledge artifacts and claims by query keyword or concept.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or question' },
          limit: { type: 'number', description: 'Max results to return (default: 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'artifact_read',
      description: 'Read the full compiled Living Knowledge Artifact for a canonical knowledge node.',
      parameters: {
        type: 'object',
        properties: {
          knowledgeNodeId: { type: 'string', description: 'Canonical knowledge node ID' },
        },
        required: ['knowledgeNodeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'source_search',
      description: 'Search raw document chunks for verbatim source evidence (Level 2 deep retrieval).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max chunks to return (default: 3)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'graph_neighbors',
      description: 'Query knowledge graph edges (prerequisites, extensions, contrasts) around a node.',
      parameters: {
        type: 'object',
        properties: {
          knowledgeNodeId: { type: 'string', description: 'Canonical knowledge node ID' },
          direction: { type: 'string', enum: ['prerequisites', 'successors', 'all'] },
        },
        required: ['knowledgeNodeId'],
      },
    },
  },
];

export const DOMAIN_TOOLS_DEFINITIONS = TUTOR_AGENT_TOOLS;
