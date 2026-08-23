import { randomUUID } from 'node:crypto';
import type { AssessmentResult } from '@opentutor/protocol';
import { AssessmentEvaluator, MasteryPolicy } from '@opentutor/assessment-core';
import type { LessonService } from './lesson-service.ts';
import type { KnowledgeService } from './knowledge-service.ts';
import type { LearningProgressService } from './learning-progress-service.ts';

export interface SubmitAnswerInput {
  sessionId: string;
  userId?: string;
  lessonId: string;
  blockId: string;
  answer: string;
}

export class AssessmentService {
  private readonly lessonService: LessonService;
  private readonly knowledgeService: KnowledgeService;
  private readonly progressService: LearningProgressService;
  private readonly evaluator: AssessmentEvaluator;
  private readonly policy: MasteryPolicy;

  constructor(
    lessonService: LessonService,
    knowledgeService: KnowledgeService,
    progressService: LearningProgressService
  ) {
    this.lessonService = lessonService;
    this.knowledgeService = knowledgeService;
    this.progressService = progressService;
    this.evaluator = new AssessmentEvaluator();
    this.policy = new MasteryPolicy();
  }

  submitAnswer(input: SubmitAnswerInput): { assessment: AssessmentResult } {
    const lesson = this.lessonService.getLesson(input.lessonId);
    if (!lesson) {
      throw new Error(`Lesson ${input.lessonId} not found`);
    }

    const block = lesson.blocks.find((b) => b.id === input.blockId);
    let evaluationResult: 'correct' | 'partial' | 'incorrect' = 'correct';
    let feedback = '';

    if (block && block.type === 'quiz') {
      if (block.answerSpec) {
        if (block.answerSpec.type === 'single_choice') {
          const evalObj = this.evaluator.evaluateObjective(
            { correctAnswer: block.answerSpec.correctOptionId },
            input.answer
          );
          evaluationResult = evalObj.result;
          feedback = evalObj.feedback;
        } else if (block.answerSpec.type === 'multiple_choice') {
          const evalObj = this.evaluator.evaluateObjective(
            { correctAnswers: block.answerSpec.correctOptionIds },
            input.answer
          );
          evaluationResult = evalObj.result;
          feedback = evalObj.feedback;
        } else if (block.answerSpec.type === 'open') {
          const evalOpen = this.evaluator.evaluateOpenAnswer(
            input.answer,
            {
              keywords: block.answerSpec.rubric.concepts,
              referenceAnswer: block.answerSpec.rubric.referenceAnswer,
              minScoreForCorrect: 0.25,
            }
          );
          evaluationResult = evalOpen.result;
          feedback = evalOpen.feedback;
        }
      } else if (block.options && block.options.length > 0) {
        const evalObj = this.evaluator.evaluateObjective(
          {
            type: block.answerType === 'multiple_choice' ? 'multiple' : 'single',
            correctAnswer: block.options[0]?.id ?? block.options[0]?.text,
          },
          input.answer
        );
        evaluationResult = evalObj.result;
        feedback = evalObj.feedback;
      } else {
        const keywords = input.lessonId.includes('softmax')
          ? ['probability', 'sum', '1', 'softmax', 'positive']
          : ['context', 'attention', 'token', 'tokens', 'information', 'surrounding', 'word'];
        const evalOpen = this.evaluator.evaluateOpenAnswer(
          input.answer,
          {
            keywords,
            minScoreForCorrect: 0.25,
          }
        );
        evaluationResult = evalOpen.result;
        feedback = evalOpen.feedback;
      }
    } else {
      evaluationResult = input.answer.trim().length > 0 ? 'correct' : 'incorrect';
      feedback = evaluationResult === 'correct' ? 'Diagnostic evaluation accepted.' : 'Please provide a valid answer.';
    }

    const userId = input.userId ?? 'default-user';
    const userState = this.knowledgeService.getUserKnowledgeState(userId, lesson.knowledgeNodeId);
    const previousConfidence = userState ? userState.confidence : 0.60;
    const newConfidence = this.policy.updateConfidence(previousConfidence, evaluationResult);
    const newStatus = this.policy.statusForConfidence(newConfidence);

    const assessment: AssessmentResult = {
      id: `asmt-${randomUUID()}`,
      knowledgeNodeId: lesson.knowledgeNodeId,
      lessonId: input.lessonId,
      blockId: input.blockId,
      result: evaluationResult,
      confidence: newConfidence,
      feedback: feedback || `Evaluated answer: ${evaluationResult}`,
    };

    this.knowledgeService.recordAssessment(input.sessionId, assessment);
    this.progressService.onKnowledgeStateUpdated(
      input.sessionId,
      lesson.knowledgeNodeId,
      newStatus,
      newConfidence
    );

    return { assessment };
  }
}
