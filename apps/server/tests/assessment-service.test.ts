import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentService } from '../src/services/assessment-service.ts';
import type { LessonService } from '../src/services/lesson-service.ts';
import type { KnowledgeService } from '../src/services/knowledge-service.ts';
import type { LearningProgressService } from '../src/services/learning-progress-service.ts';
import type { Lesson, UserKnowledgeState } from '@opentutor/protocol';

describe('AssessmentService validation & evaluation', () => {
  const dummyLesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-test',
    courseId: 'course-test',
    knowledgeNodeId: 'node-test',
    title: 'Test Lesson',
    status: 'active',
    version: 1,
    blocks: [
      {
        id: 'block-text-1',
        type: 'text',
        variant: 'paragraph',
        content: 'Some introductory text.',
      },
      {
        id: 'quiz-block-1',
        type: 'quiz',
        question: 'What is 2+2?',
        answerType: 'single_choice',
        options: [
          { id: 'opt-3', text: '3' },
          { id: 'opt-4', text: '4' },
        ],
        answerSpec: {
          type: 'single_choice',
          correctOptionId: 'opt-4',
        },
      },
      {
        id: 'quiz-probe-1',
        type: 'quiz',
        question: 'What is a prerequisite concept?',
        answerType: 'single_choice',
        targetKnowledgeNodeId: 'prereq-node-1',
        assessmentKind: 'probe',
        candidateMisconceptionIds: ['misc-prereq-1'],
        options: [
          { id: 'opt-a', text: 'Answer A' },
          { id: 'opt-b', text: 'Answer B' },
        ],
        answerSpec: {
          type: 'single_choice',
          correctOptionId: 'opt-a',
        },
      },
    ],
  };

  const mockLessonService: LessonService = {
    getLesson(id: string) {
      if (id === 'lesson-test') return dummyLesson;
      return null;
    },
  } as unknown as LessonService;

  interface RecordedEntry {
    sessionId: string;
    assessment: { knowledgeNodeId: string; result: string; confidence: number };
    userId: string;
    options?: { difficulty?: unknown; confidence?: number; sourceItemId?: string; type?: string; candidateMisconceptionIds?: string[] };
  }
  const recordedAssessments: RecordedEntry[] = [];
  const mockKnowledgeService: KnowledgeService = {
    recordAssessment(sessionId: string, assessment: { knowledgeNodeId: string; result: 'correct' | 'partial' | 'incorrect'; confidence: number }, userId: string, options?: { difficulty?: unknown; confidence?: number; sourceItemId?: string; type?: any; candidateMisconceptionIds?: string[] }) {
      recordedAssessments.push({ sessionId, assessment, userId, options });
      return {
        userId,
        knowledgeNodeId: assessment.knowledgeNodeId,
        status: assessment.result === 'correct' ? 'learning' : 'weak',
        confidence: assessment.confidence,
        masteryProbability: 0.5,
        alpha: 1.0,
        beta: 1.0,
        evidenceCount: 1,
        correctCount: assessment.result === 'correct' ? 1 : 0,
        incorrectCount: assessment.result === 'incorrect' ? 1 : 0,
        stability: 7.0,
        difficulty: 1.0,
        lastAssessedAt: new Date().toISOString(),
        lastReviewedAt: new Date().toISOString(),
      } as unknown as UserKnowledgeState;
    },
  } as unknown as KnowledgeService;

  const mockProgressService: LearningProgressService = {
    onKnowledgeStateUpdated() {},
  } as unknown as LearningProgressService;

  const service = new AssessmentService(
    mockLessonService,
    mockKnowledgeService,
    mockProgressService
  );

  it('throws Lesson not found if lesson is missing', () => {
    assert.throws(
      () => {
        service.submitAnswer({
          sessionId: 's-1',
          lessonId: 'missing-lesson',
          blockId: 'quiz-block-1',
          answer: 'opt-4',
        });
      },
      { message: 'Lesson missing-lesson not found' }
    );
  });

  it('throws BLOCK_NOT_FOUND if block does not exist in lesson', () => {
    assert.throws(
      () => {
        service.submitAnswer({
          sessionId: 's-1',
          lessonId: 'lesson-test',
          blockId: 'non-existent-block',
          answer: 'opt-4',
        });
      },
      { message: 'BLOCK_NOT_FOUND' }
    );
  });

  it('throws BLOCK_NOT_ASSESSABLE if block is not a quiz', () => {
    assert.throws(
      () => {
        service.submitAnswer({
          sessionId: 's-1',
          lessonId: 'lesson-test',
          blockId: 'block-text-1',
          answer: 'some answer',
        });
      },
      { message: 'BLOCK_NOT_ASSESSABLE' }
    );
  });

  it('evaluates correct answer and passes sourceItemId: block.id to recordAssessment', () => {
    recordedAssessments.length = 0;
    const { assessment } = service.submitAnswer({
      sessionId: 's-1',
      lessonId: 'lesson-test',
      blockId: 'quiz-block-1',
      answer: 'opt-4',
    });

    assert.equal(assessment.result, 'correct');
    assert.equal(assessment.confidence, 1.0);
    assert.equal(recordedAssessments.length, 1);
    assert.equal(recordedAssessments[0]?.options?.sourceItemId, 'quiz-block-1');
    assert.equal(recordedAssessments[0]?.options?.confidence, 1.0);
  });

  it('evaluates incorrect answer with evidenceConfidence = 1.0 and passes sourceItemId', () => {
    recordedAssessments.length = 0;
    const { assessment } = service.submitAnswer({
      sessionId: 's-1',
      lessonId: 'lesson-test',
      blockId: 'quiz-block-1',
      answer: 'opt-3',
    });

    assert.equal(assessment.result, 'incorrect');
    assert.equal(assessment.confidence, 1.0);
    assert.equal(recordedAssessments.length, 1);
    assert.equal(recordedAssessments[0]?.options?.sourceItemId, 'quiz-block-1');
    assert.equal(recordedAssessments[0]?.options?.confidence, 1.0);
  });

  it('routes assessment and evidence to targetKnowledgeNodeId when specified on quiz probe block', () => {
    recordedAssessments.length = 0;
    const { assessment } = service.submitAnswer({
      sessionId: 's-1',
      lessonId: 'lesson-test',
      blockId: 'quiz-probe-1',
      answer: 'opt-a',
    });

    assert.equal(assessment.knowledgeNodeId, 'prereq-node-1');
    assert.equal(assessment.result, 'correct');
    assert.equal(recordedAssessments.length, 1);
    assert.equal(recordedAssessments[0]?.assessment.knowledgeNodeId, 'prereq-node-1');
    assert.equal(recordedAssessments[0]?.options?.sourceItemId, 'quiz-probe-1');
    assert.equal(recordedAssessments[0]?.options?.type, 'probe');
    assert.deepEqual(recordedAssessments[0]?.options?.candidateMisconceptionIds, ['misc-prereq-1']);
  });

  it('ensures zero mutation when BLOCK_NOT_FOUND or BLOCK_NOT_ASSESSABLE occurs', () => {
    recordedAssessments.length = 0;
    assert.throws(
      () => {
        service.submitAnswer({
          sessionId: 's-1',
          lessonId: 'lesson-test',
          blockId: 'non-existent',
          answer: 'any',
        });
      },
      { message: 'BLOCK_NOT_FOUND' }
    );
    assert.equal(recordedAssessments.length, 0, 'No assessment should be recorded on BLOCK_NOT_FOUND');

    assert.throws(
      () => {
        service.submitAnswer({
          sessionId: 's-1',
          lessonId: 'lesson-test',
          blockId: 'block-text-1',
          answer: 'any',
        });
      },
      { message: 'BLOCK_NOT_ASSESSABLE' }
    );
    assert.equal(recordedAssessments.length, 0, 'No assessment should be recorded on BLOCK_NOT_ASSESSABLE');
  });
});
