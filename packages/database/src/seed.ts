import type Database from 'better-sqlite3';
import type { LearningPathNode, Lesson, LessonBlock } from '@opentutor/protocol';

export const DEFAULT_USER_ID = 'default-user';
export const DEFAULT_SESSION_ID = 'prototype';
export const DEFAULT_COURSE_ID = 'transformer';

export const INITIAL_LESSON: Lesson = {
  schemaVersion: '1.0',
  id: 'lesson-self-attention',
  courseId: 'transformer',
  knowledgeNodeId: 'self-attention',
  title: 'Self Attention',
  objective: 'Understand why a token needs information from other tokens.',
  version: 1,
  status: 'active',
  blocks: [
    {
      id: 'intro',
      type: 'text',
      variant: 'paragraph',
      content:
        'When you read a sentence, the meaning of one word often depends on other words around it. Self-attention gives each token a way to gather the context it needs.',
    },
    {
      id: 'definition',
      type: 'text',
      variant: 'definition',
      content:
        'Self-attention lets each token build a new representation by weighting information from tokens in the same sequence.',
    },
    {
      id: 'diagram',
      type: 'diagram',
      diagramType: 'relationship',
      nodes: [
        { id: 'animal', label: 'animal' },
        { id: 'was', label: 'was' },
        { id: 'tired', label: 'tired' },
      ],
      edges: [
        { from: 'animal', to: 'tired', label: '0.82' },
        { from: 'animal', to: 'was', label: '0.10' },
      ],
    },
    {
      id: 'quiz',
      type: 'quiz',
      answerType: 'text',
      question: 'Why might a token need information from another token?',
    },
  ],
};

export const INITIAL_PATH_NODES: LearningPathNode[] = [
  { id: 'embedding', knowledgeNodeId: 'embedding', title: 'Embedding', type: 'main', status: 'completed', position: 0 },
  { id: 'self-attention', knowledgeNodeId: 'self-attention', title: 'Self Attention', type: 'main', status: 'current', position: 1 },
  { id: 'multi-head', knowledgeNodeId: 'multi-head', title: 'Multi-Head Attention', type: 'main', status: 'upcoming', position: 2 },
  { id: 'transformer-block', knowledgeNodeId: 'transformer-block', title: 'Transformer Block', type: 'main', status: 'upcoming', position: 3 },
  { id: 'gpt', knowledgeNodeId: 'gpt', title: 'GPT Architecture', type: 'main', status: 'upcoming', position: 4 },
];

export function seedDatabase(db: Database.Database): void {
  const now = new Date().toISOString();

  const seedTx = db.transaction(() => {
    // 1. Knowledge nodes
    const insertNode = db.prepare(`
      INSERT OR REPLACE INTO knowledge_nodes (id, title, description, created_at)
      VALUES (?, ?, ?, ?)
    `);

    insertNode.run('embedding', 'Embedding', 'Vector representation of tokens in continuous vector space.', now);
    insertNode.run('softmax', 'Softmax Function', 'Converts vector logits into a normalized probability distribution.', now);
    insertNode.run('self-attention', 'Self Attention', 'Mechanism for weighting token representations based on sequence context.', now);
    insertNode.run('multi-head', 'Multi-Head Attention', 'Multiple parallel attention mechanisms capturing diverse subspace representations.', now);
    insertNode.run('transformer-block', 'Transformer Block', 'Combined attention and feedforward layers with residual connections and layer normalization.', now);
    insertNode.run('gpt', 'GPT Architecture', 'Autoregressive decoder-only Transformer for language generation.', now);

    // 2. Knowledge edges (prerequisites)
    const insertEdge = db.prepare(`
      INSERT OR REPLACE INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
      VALUES (?, ?, ?, ?)
    `);

    insertEdge.run('embedding', 'self-attention', 'prerequisite', now);
    insertEdge.run('self-attention', 'multi-head', 'prerequisite', now);
    insertEdge.run('multi-head', 'transformer-block', 'prerequisite', now);
    insertEdge.run('transformer-block', 'gpt', 'prerequisite', now);

    // 3. Course
    const insertCourse = db.prepare(`
      INSERT OR REPLACE INTO courses (id, title, description, created_at)
      VALUES (?, ?, ?, ?)
    `);

    insertCourse.run(
      'transformer',
      'Transformer Architecture',
      'Master the core building blocks of modern LLMs from attention to autoregression.',
      now
    );

    // 4. Course nodes
    const insertCourseNode = db.prepare(`
      INSERT OR REPLACE INTO course_nodes (course_id, knowledge_node_id, position)
      VALUES (?, ?, ?)
    `);

    insertCourseNode.run('transformer', 'embedding', 0);
    insertCourseNode.run('transformer', 'self-attention', 1);
    insertCourseNode.run('transformer', 'multi-head', 2);
    insertCourseNode.run('transformer', 'transformer-block', 3);
    insertCourseNode.run('transformer', 'gpt', 4);

    // 5. Initial lesson
    const insertLesson = db.prepare(`
      INSERT OR REPLACE INTO lessons (id, course_id, knowledge_node_id, title, objective, version, status, blocks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLesson.run(
      INITIAL_LESSON.id,
      INITIAL_LESSON.courseId,
      INITIAL_LESSON.knowledgeNodeId,
      INITIAL_LESSON.title,
      INITIAL_LESSON.objective ?? null,
      INITIAL_LESSON.version,
      INITIAL_LESSON.status,
      JSON.stringify(INITIAL_LESSON.blocks),
      now,
      now
    );

    // 6. Initial lesson version
    const insertLessonVersion = db.prepare(`
      INSERT OR REPLACE INTO lesson_versions (lesson_id, version, title, objective, status, blocks, patches, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLessonVersion.run(
      INITIAL_LESSON.id,
      INITIAL_LESSON.version,
      INITIAL_LESSON.title,
      INITIAL_LESSON.objective ?? null,
      INITIAL_LESSON.status,
      JSON.stringify(INITIAL_LESSON.blocks),
      JSON.stringify([]),
      now
    );

    // 7. Prototype session
    const insertSession = db.prepare(`
      INSERT OR REPLACE INTO learning_sessions (id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertSession.run('prototype', 'default-user', 'transformer', INITIAL_LESSON.id, 1, now, now);

    // 8. Learning path nodes
    const insertPathNode = db.prepare(`
      INSERT OR REPLACE INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const node of INITIAL_PATH_NODES) {
      insertPathNode.run(
        node.id,
        'prototype',
        node.knowledgeNodeId,
        node.title,
        node.type,
        node.status,
        node.position,
        node.note ?? null,
        now,
        now
      );
    }
  });

  seedTx();
}
