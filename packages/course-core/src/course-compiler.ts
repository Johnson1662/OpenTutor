import type { Database } from '@opentutor/database';
import type { LearningPathNode, UserKnowledgeState } from '@opentutor/protocol';
import { EntityResolver } from '@opentutor/knowledge-core';
import type {
  CompileCourseInput,
  CourseGraph,
  CourseGoalAnalysis,
} from './course-types.ts';
import type { GoalAnalyzer } from './goal-analyzer.ts';
import { FakeGoalAnalyzer } from './goal-analyzer.ts';
import { PrerequisiteResolver } from './prerequisite-resolver.ts';
import { GraphBuilder } from './graph-builder.ts';
import { PathPlanner } from './path-planner.ts';

export class CourseCompiler {
  private readonly db: Database;
  private readonly goalAnalyzer: GoalAnalyzer;
  private readonly entityResolver: EntityResolver;
  private readonly prereqResolver: PrerequisiteResolver;
  private readonly graphBuilder: GraphBuilder;
  private readonly pathPlanner: PathPlanner;

  constructor(
    db: Database,
    goalAnalyzer?: GoalAnalyzer
  ) {
    this.db = db;
    this.goalAnalyzer = goalAnalyzer ?? new FakeGoalAnalyzer();
    this.entityResolver = new EntityResolver(db);
    this.prereqResolver = new PrerequisiteResolver(db);
    this.graphBuilder = new GraphBuilder(db);
    this.pathPlanner = new PathPlanner();
  }

  async compileCourse(input: CompileCourseInput): Promise<{
    courseGraph: CourseGraph;
    initialPath: LearningPathNode[];
    goalAnalysis: CourseGoalAnalysis;
  }> {
    // 1. Analyze user learning goal
    const goalAnalysis = await this.goalAnalyzer.analyzeGoal(input.learningGoal);

    // 2. Resolve target concept names to knowledge nodes in the Global Knowledge Graph
    const targetNodeIds: string[] = [];
    for (const targetName of goalAnalysis.targetConcepts) {
      const entity = this.entityResolver.resolve(targetName);
      targetNodeIds.push(entity.id);
    }

    // 3. Compute transitive prerequisite closure
    const closure = this.prereqResolver.resolveClosure(targetNodeIds);

    // 4. Build and persist course graph projection
    const courseTitle = input.title || `Mastering ${goalAnalysis.targetConcepts[0] ?? 'Course'}`;
    const courseGraph = this.graphBuilder.buildCourseGraph(
      input.courseId,
      courseTitle,
      closure.orderedNodeIds,
      targetNodeIds,
      closure.prerequisiteMap
    );

    // 5. Fetch existing user knowledge states if userId is provided
    let userStates: UserKnowledgeState[] = [];
    if (input.userId) {
      const rows = this.db
        .prepare(
          `SELECT knowledge_node_id, status, confidence FROM user_knowledge_states WHERE user_id = ?`
        )
        .all(input.userId) as Array<{ knowledge_node_id: string; status: string; confidence: number }>;

      userStates = rows.map((r) => ({
        knowledgeNodeId: r.knowledge_node_id,
        status: r.status as UserKnowledgeState['status'],
        confidence: r.confidence,
      }));
    }

    // 6. Plan personalized initial learning path
    const initialPath = this.pathPlanner.planInitialPath(courseGraph, userStates);

    return {
      courseGraph,
      initialPath,
      goalAnalysis,
    };
  }
}
