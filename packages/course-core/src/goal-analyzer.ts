import type { ModelExecutionService } from '@opentutor/model-runtime';
import {
  CourseGoalAnalysisSchema,
  type CourseGoalAnalysis,
} from './course-types.ts';

export interface GoalAnalyzer {
  analyzeGoal(goal: string): Promise<CourseGoalAnalysis>;
}

export class ModelGoalAnalyzer implements GoalAnalyzer {
  private readonly executionService: ModelExecutionService;

  constructor(executionService: ModelExecutionService) {
    this.executionService = executionService;
  }

  async analyzeGoal(goal: string): Promise<CourseGoalAnalysis> {
    const system = `You are an expert curriculum designer and pedagogical goal analyzer.
Analyze the user's learning goal and extract:
1. 'targetConcepts': canonical names of key concepts or topics to master (e.g., 'Transformer Architecture', 'Self-Attention').
2. 'depth': 'beginner', 'intermediate', or 'advanced'.
3. 'constraints': any explicit constraints or preferences mentioned by the user.`;

    const prompt = `Analyze this learning goal:\n"${goal}"`;

    return await this.executionService.completeStructured<CourseGoalAnalysis>({
      role: 'course_planner',
      system,
      prompt,
      schema: CourseGoalAnalysisSchema,
    });
  }
}

export class FakeGoalAnalyzer implements GoalAnalyzer {
  async analyzeGoal(goal: string): Promise<CourseGoalAnalysis> {
    const lower = goal.toLowerCase();
    const targets: string[] = [];

    if (lower.includes('transformer')) {
      targets.push('Self-Attention', 'Transformer Architecture');
    }
    if (lower.includes('softmax')) {
      targets.push('Softmax Function');
    }
    if (lower.includes('attention') && !targets.includes('Self-Attention')) {
      targets.push('Attention Mechanism');
    }

    if (targets.length === 0) {
      targets.push('General Concept');
    }

    return {
      targetConcepts: targets,
      depth: lower.includes('from scratch') || lower.includes('beginner') ? 'beginner' : 'intermediate',
    };
  }
}
