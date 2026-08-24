import { randomUUID } from 'node:crypto';
import type { AssessmentResult } from '@opentutor/protocol';
import { AssessmentEvaluator } from '@opentutor/assessment-core';
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

  constructor(
    lessonService: LessonService,
    knowledgeService: KnowledgeService,
    progressService: LearningProgressService
  ) {
    this.lessonService = lessonService;
    this.knowledgeService = knowledgeService;
    this.progressService = progressService;
    this.evaluator = new AssessmentEvaluator();
  }

  submitAnswer(input: SubmitAnswerInput): { assessment: AssessmentResult } {
    const lesson = this.lessonService.getLesson(input.lessonId);
    if (!lesson) {
      throw new Error(`Lesson ${input.lessonId} not found`);
    }

    const block = lesson.blocks.find((b) => b.id === input.blockId);
    if (!block) {
      throw new Error('BLOCK_NOT_FOUND');
    }
    if (block.type !== 'quiz') {
      throw new Error('BLOCK_NOT_ASSESSABLE');
    }

    let evaluationResult: 'correct' | 'partial' | 'incorrect' = 'correct';
    let evaluationConfidence = 1.0;
    let feedback = '';
    const difficulty = ('difficulty' in block && (typeof block.difficulty === 'number' || typeof block.difficulty === 'string')) ? block.difficulty : 'medium';

    if (block.answerSpec) {
      if (block.answerSpec.type === 'single_choice') {
        const evalObj = this.evaluator.evaluateObjective(
          { correctAnswer: block.answerSpec.correctOptionId },
          input.answer
        );
        evaluationResult = evalObj.result;
        evaluationConfidence = evalObj.evidenceConfidence ?? evalObj.confidence ?? 1.0;
        feedback = evalObj.feedback;
      } else if (block.answerSpec.type === 'multiple_choice') {
        const evalObj = this.evaluator.evaluateObjective(
          { correctAnswers: block.answerSpec.correctOptionIds },
          input.answer
        );
        evaluationResult = evalObj.result;
        evaluationConfidence = evalObj.evidenceConfidence ?? evalObj.confidence ?? 1.0;
        feedback = evalObj.feedback;
      } else if (block.answerSpec.type === 'open') {
        const evalOpen = this.evaluator.evaluateOpenAnswer(
          input.answer,
          {
            keywords: block.answerSpec.rubric?.concepts,
            referenceAnswer: block.answerSpec.rubric?.referenceAnswer,
            minScoreForCorrect: 0.25,
          }
        );
        evaluationResult = evalOpen.result;
        evaluationConfidence = evalOpen.evidenceConfidence ?? evalOpen.confidence ?? 1.0;
        feedback = evalOpen.feedback;
      }
    } else if (block.options && block.options.length > 0) {
      const rawBlock = block as unknown as Record<string, unknown>;
      const firstOption = block.options[0];
      const correctVal =
        (typeof rawBlock.correctAnswer === 'string' ? rawBlock.correctAnswer : undefined) ??
        (typeof firstOption === 'string'
          ? firstOption
          : firstOption && typeof firstOption === 'object'
            ? ('id' in firstOption && typeof firstOption.id === 'string' ? firstOption.id : ('text' in firstOption && typeof firstOption.text === 'string' ? firstOption.text : undefined))
            : undefined);
      const evalObj = this.evaluator.evaluateObjective(
        {
          type: block.answerType === 'multiple_choice' ? 'multiple' : 'single',
          correctAnswer: correctVal,
        },
        input.answer
      );
      evaluationResult = evalObj.result;
      evaluationConfidence = evalObj.evidenceConfidence ?? evalObj.confidence ?? 1.0;
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
      evaluationConfidence = evalOpen.evidenceConfidence ?? evalOpen.confidence ?? 1.0;
      feedback = evalOpen.feedback;
    }

    const userId = input.userId ?? 'default-user';
    const targetKnowledgeNodeId =
      ('targetKnowledgeNodeId' in block && typeof block.targetKnowledgeNodeId === 'string' && block.targetKnowledgeNodeId.trim())
        ? block.targetKnowledgeNodeId
        : lesson.knowledgeNodeId;

    const assessmentKind = ('assessmentKind' in block && typeof block.assessmentKind === 'string')
      ? block.assessmentKind
      : undefined;
    const evidenceType: 'quiz' | 'probe' = assessmentKind === 'probe' ? 'probe' : 'quiz';
    const candidateMisconceptionIds: string[] | undefined =
      ('candidateMisconceptionIds' in block && Array.isArray(block.candidateMisconceptionIds))
        ? block.candidateMisconceptionIds
        : undefined;

    const assessment: AssessmentResult = {
      id: `asmt-${randomUUID()}`,
      knowledgeNodeId: targetKnowledgeNodeId,
      lessonId: input.lessonId,
      blockId: input.blockId,
      result: evaluationResult,
      confidence: evaluationConfidence,
      feedback: feedback || `Evaluated answer: ${evaluationResult}`,
    };

    const updatedState = this.knowledgeService.recordAssessment(
      input.sessionId,
      assessment,
      userId,
      {
        difficulty,
        confidence: evaluationConfidence,
        sourceItemId: block.id,
        type: evidenceType,
        candidateMisconceptionIds,
      }
    );

    this.progressService.onKnowledgeStateUpdated(input.sessionId, updatedState);
    return { assessment };
  }
}
