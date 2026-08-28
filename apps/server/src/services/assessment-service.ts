import { randomUUID } from 'node:crypto';
import type { AssessmentResult, LearningDiagnosis, LearningEvidence, UserKnowledgeState } from '@opentutor/protocol';
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

  submitAnswer(input: SubmitAnswerInput): { assessment: AssessmentResult; state?: UserKnowledgeState; evidence?: LearningEvidence; diagnosis?: LearningDiagnosis | null } {
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
    let evaluationScore = 1.0;
    let feedback = '';
    const hasDifficulty = 'difficulty' in block && (typeof block.difficulty === 'number' || typeof block.difficulty === 'string');
    const isProbe = 'assessmentKind' in block && block.assessmentKind === 'probe';
    // Probe blocks are weak diagnostic evidence: a failed probe must not outweigh
    // correct quizzes, and two quizzes plus one failed probe must stay below mastery.
    const difficulty = isProbe
      ? 0.3
      : (hasDifficulty ? block.difficulty : 'medium');

    if (block.answerSpec) {
      if (block.answerSpec.type === 'single_choice') {
        const evalObj = this.evaluator.evaluateObjective(
          { correctAnswer: block.answerSpec.correctOptionId },
          input.answer
        );
        evaluationResult = evalObj.result;
        evaluationConfidence = evalObj.evidenceConfidence ?? evalObj.confidence ?? 1.0;
        evaluationScore = evalObj.score !== undefined ? evalObj.score : (evalObj.result === 'correct' ? 1.0 : evalObj.result === 'partial' ? 0.5 : 0.0);
        feedback = evalObj.feedback;
      } else if (block.answerSpec.type === 'multiple_choice') {
        const evalObj = this.evaluator.evaluateObjective(
          { correctAnswers: block.answerSpec.correctOptionIds },
          input.answer
        );
        evaluationResult = evalObj.result;
        evaluationConfidence = evalObj.evidenceConfidence ?? evalObj.confidence ?? 1.0;
        evaluationScore = evalObj.score !== undefined ? evalObj.score : (evalObj.result === 'correct' ? 1.0 : evalObj.result === 'partial' ? 0.5 : 0.0);
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
        evaluationScore = evalOpen.score !== undefined ? evalOpen.score : (evalOpen.result === 'correct' ? 1.0 : evalOpen.result === 'partial' ? 0.5 : 0.0);
        feedback = evalOpen.feedback;
      } else {
        throw new Error('QUIZ_ANSWER_SPEC_INVALID');
      }
    } else {
      throw new Error('QUIZ_ANSWER_SPEC_MISSING');
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
        score: evaluationScore,
        sourceItemId: block.id,
        type: evidenceType,
        candidateMisconceptionIds,
      }
    );

    this.progressService.onKnowledgeStateUpdated(input.sessionId, updatedState);
    return {
      assessment,
      state: updatedState,
      evidence: updatedState.evidence,
      diagnosis: updatedState.diagnosis,
    };
  }
}
