import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from '@opentutor/database';
import {
  FakeGoalAnalyzer,
  PrerequisiteResolver,
  GraphBuilder,
  PathPlanner,
  CourseCompiler,
} from '../src/index.ts';

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

  await t.test('2. PrerequisiteResolver computes transitive closure and topological ordering', () => {
    const resolver = new PrerequisiteResolver(db);
    // In seed database, self-attention has prerequisite embedding
    const closure = resolver.resolveClosure(['self-attention']);

    assert.ok(closure.orderedNodeIds.includes('self-attention'));
    assert.ok(closure.orderedNodeIds.includes('embedding'));
    // embedding should come before self-attention in topological order
    const embeddingIdx = closure.orderedNodeIds.indexOf('embedding');
    const selfAttnIdx = closure.orderedNodeIds.indexOf('self-attention');
    assert.ok(embeddingIdx < selfAttnIdx);
    assert.equal(closure.hasCycle, false);
  });

  await t.test('3. GraphBuilder projects closure into CourseGraph and persists into SQLite', () => {
    const builder = new GraphBuilder(db);
    const graph = builder.buildCourseGraph(
      'course-test-1',
      'Understanding Attention',
      ['softmax', 'self-attention'],
      ['self-attention'],
      new Map([['self-attention', ['softmax']]])
    );

    assert.equal(graph.courseId, 'course-test-1');
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.nodes[0]?.role, 'prerequisite');
    assert.equal(graph.nodes[1]?.role, 'core');

    // Verify database tables
    const dbNodes = db.prepare('SELECT * FROM course_nodes WHERE course_id = ?').all('course-test-1');
    assert.equal(dbNodes.length, 2);

    const dbEdges = db.prepare('SELECT * FROM course_edges WHERE course_id = ?').all('course-test-1');
    assert.equal(dbEdges.length, 1);
  });

  await t.test('4. PathPlanner creates active path and skips user-mastered nodes', () => {
    const planner = new PathPlanner();
    const mockGraph = {
      courseId: 'course-test-2',
      title: 'Test Course',
      nodes: [
        { courseId: 'c1', knowledgeNodeId: 'softmax', title: 'Softmax', role: 'prerequisite' as const, position: 1 },
        { courseId: 'c1', knowledgeNodeId: 'self-attention', title: 'Self-Attention', role: 'core' as const, position: 2 },
        { courseId: 'c1', knowledgeNodeId: 'multi-head-attention', title: 'Multi-Head Attention', role: 'core' as const, position: 3 },
      ],
      edges: [],
    };

    // User has already mastered softmax
    const userStates = [
      { knowledgeNodeId: 'softmax', status: 'mastered' as const, confidence: 0.9 },
    ];

    const path = planner.planInitialPath(mockGraph, userStates);
    assert.equal(path.length, 3);
    assert.equal(path[0]?.status, 'completed');
    assert.equal(path[1]?.status, 'current');
    assert.equal(path[2]?.status, 'upcoming');
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
