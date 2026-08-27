import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from '@opentutor/database';
import { FakeGoalAnalyzer, CourseCompiler } from '../src/index.ts';

test('packages/course-core - Course Domain & Compilation Pipeline', async (t) => {
  const db = createDatabase(':memory:');
  seedDatabase(db);

  await t.test('1. GoalAnalyzer extracts target concepts and depth', async () => {
    const analyzer = new FakeGoalAnalyzer();
    const analysis = await analyzer.analyzeGoal('I want to learn Transformer from scratch');

    assert.ok(analysis.targetConcepts.includes('Self-Attention'));
    assert.ok(analysis.targetConcepts.includes('Transformer Architecture'));
    assert.equal(analysis.depth, 'beginner');
  });

  await t.test('2. CourseCompiler orders prerequisites and persists the course graph', async () => {
    const compiler = new CourseCompiler(db, {
      async analyzeGoal() {
        return { targetConcepts: ['Self Attention'], depth: 'beginner' };
      },
    });
    const result = await compiler.compileCourse({
      courseId: 'course-test-1',
      title: 'Understanding Attention',
      learningGoal: 'Learn self attention',
    });

    const embeddingIdx = result.courseGraph.nodes.findIndex((node) => node.knowledgeNodeId === 'embedding');
    const selfAttnIdx = result.courseGraph.nodes.findIndex((node) => node.knowledgeNodeId === 'self-attention');
    assert.ok(embeddingIdx >= 0);
    assert.ok(selfAttnIdx >= 0);
    assert.ok(embeddingIdx < selfAttnIdx);
    assert.equal(result.courseGraph.nodes[embeddingIdx]?.role, 'prerequisite');
    assert.equal(result.courseGraph.nodes[selfAttnIdx]?.role, 'core');

    const dbNodes = db.prepare('SELECT * FROM course_nodes WHERE course_id = ?').all('course-test-1');
    assert.equal(dbNodes.length, 2);

    const dbEdges = db.prepare('SELECT * FROM course_edges WHERE course_id = ?').all('course-test-1');
    assert.equal(dbEdges.length, 1);
  });

  await t.test('3. CourseCompiler plans around mastered prerequisites', async () => {
    db.prepare(
      `INSERT INTO user_knowledge_states (user_id, knowledge_node_id, status, confidence, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run('path-user', 'embedding', 'mastered', 0.9);

    const compiler = new CourseCompiler(db, {
      async analyzeGoal() {
        return { targetConcepts: ['Self Attention'], depth: 'beginner' };
      },
    });
    const result = await compiler.compileCourse({
      courseId: 'course-test-path',
      learningGoal: 'Learn self attention',
      userId: 'path-user',
    });

    const embedding = result.initialPath.find((node) => node.knowledgeNodeId === 'embedding');
    const selfAttention = result.initialPath.find((node) => node.knowledgeNodeId === 'self-attention');
    assert.equal(embedding?.status, 'completed');
    assert.equal(selfAttention?.status, 'current');
  });

  await t.test('3b. CourseCompiler leaves no current node when every node is mastered', async () => {
    db.prepare(
      `INSERT INTO user_knowledge_states (user_id, knowledge_node_id, status, confidence, updated_at)
       VALUES (?, ?, ?, ?, datetime('now')), (?, ?, ?, ?, datetime('now'))`
    ).run(
      'all-mastered-user', 'embedding', 'mastered', 0.9,
      'all-mastered-user', 'self-attention', 'mastered', 0.9
    );

    const compiler = new CourseCompiler(db, {
      async analyzeGoal() {
        return { targetConcepts: ['Self Attention'], depth: 'beginner' };
      },
    });
    const result = await compiler.compileCourse({
      courseId: 'course-test-all-mastered',
      learningGoal: 'Learn self attention',
      userId: 'all-mastered-user',
    });

    assert.ok(result.initialPath.every((node) => node.status === 'completed'));
    assert.equal(result.initialPath.find((node) => node.status === 'current'), undefined);
  });

  await t.test('4. CourseCompiler keeps every node when prerequisites contain a cycle', async () => {
    db.prepare(
      `INSERT OR REPLACE INTO knowledge_nodes (id, title, description, created_at)
       VALUES ('cycle-a', 'Cycle A', '', datetime('now')),
              ('cycle-b', 'Cycle B', '', datetime('now'))`
    ).run();
    db.prepare(
      `INSERT OR REPLACE INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
       VALUES ('cycle-a', 'cycle-b', 'prerequisite', datetime('now')),
              ('cycle-b', 'cycle-a', 'prerequisite', datetime('now'))`
    ).run();

    const compiler = new CourseCompiler(db, {
      async analyzeGoal() {
        return { targetConcepts: ['Cycle A'], depth: 'beginner' };
      },
    });
    const result = await compiler.compileCourse({
      courseId: 'course-cycle',
      learningGoal: 'Learn cycle A',
    });

    assert.deepEqual(
      result.courseGraph.nodes.map((node) => node.knowledgeNodeId).sort(),
      ['cycle-a', 'cycle-b']
    );
    assert.equal(result.courseGraph.edges.length, 2);
  });

  await t.test('5. CourseCompiler executes full compilation pipeline', async () => {
    const compiler = new CourseCompiler(db, new FakeGoalAnalyzer());
    const result = await compiler.compileCourse({
      courseId: 'course-full-transformer',
      title: 'Full Transformer Course',
      learningGoal: 'I want to learn Transformer from scratch',
      userId: 'default-user',
    });

    assert.equal(result.courseGraph.courseId, 'course-full-transformer');
    assert.ok(result.courseGraph.nodes.length >= 2);
    assert.ok(result.initialPath.length >= 2);
    assert.equal(result.initialPath.some((n) => n.status === 'current'), true);
  });
});
