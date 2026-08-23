export const DOMAIN_TOOLS_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'lesson_get',
      description: 'Retrieve the current active Lesson and its blocks by lesson ID.',
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
          baseVersion: { type: 'number', description: 'Current version of the lesson for optimistic concurrency verification' },
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
      description: 'Retrieve the active Learning Path nodes, current position, and path version for a session.',
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
      name: 'path_patch',
      description: 'Apply structural mutations to the Learning Path (e.g. inserting prerequisite Detour nodes or updating status).',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID of the learning session' },
          baseVersion: { type: 'number', description: 'Current version of the learning path' },
          patches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['insert_node', 'update_node', 'remove_node'] },
                nodeId: { type: 'string' },
                node: { type: 'object' },
                before: { type: 'string' },
                after: { type: 'string' },
                changes: { type: 'object' },
              },
              required: ['op'],
            },
            description: 'List of path patch operations',
          },
        },
        required: ['sessionId', 'baseVersion', 'patches'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assessment_record',
      description: 'Record a diagnostic evaluation assessment and update the learner knowledge mastery state.',
      parameters: {
        type: 'object',
        properties: {
          knowledgeNodeId: { type: 'string', description: 'ID of the evaluated knowledge node' },
          lessonId: { type: 'string', description: 'ID of the active lesson' },
          blockId: { type: 'string', description: 'Optional ID of the quiz block' },
          result: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
          confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0' },
          feedback: { type: 'string', description: 'Diagnostic feedback explanation' },
        },
        required: ['knowledgeNodeId', 'lessonId', 'result', 'confidence', 'feedback'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_get',
      description: 'Retrieve canonical concept definitions and relations for a given knowledge node ID.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'ID of the knowledge node' },
        },
        required: ['nodeId'],
      },
    },
  },
];
