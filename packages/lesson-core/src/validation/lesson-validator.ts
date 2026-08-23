import type { Lesson, LessonBlock, QuizBlock } from '@opentutor/protocol';

export interface LessonValidationResult {
  valid: boolean;
  errors: string[];
}

export class LessonValidator {
  validate(lesson: Lesson): LessonValidationResult {
    const errors: string[] = [];

    if (!lesson.id) errors.push('Lesson must have an id');
    if (!lesson.courseId) errors.push('Lesson must have a courseId');
    if (!lesson.knowledgeNodeId) errors.push('Lesson must have a knowledgeNodeId');
    if (!lesson.title) errors.push('Lesson must have a title');
    if (!Array.isArray(lesson.blocks) || lesson.blocks.length === 0) {
      errors.push('Lesson must contain at least one block');
    }

    const seenBlockIds = new Set<string>();

    for (const block of lesson.blocks || []) {
      if (!block.id) {
        errors.push('Block is missing an id');
        continue;
      }
      if (seenBlockIds.has(block.id)) {
        errors.push(`Duplicate block id: '${block.id}'`);
      }
      seenBlockIds.add(block.id);

      this.validateBlock(block, errors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateBlock(block: LessonBlock, errors: string[]): void {
    switch (block.type) {
      case 'text':
        if (typeof block.content !== 'string' || block.content.trim().length === 0) {
          errors.push(`Text block '${block.id}' has empty content`);
        }
        break;
      case 'code':
        if (typeof block.code !== 'string') {
          errors.push(`Code block '${block.id}' has invalid code`);
        }
        break;
      case 'diagram':
        if (!Array.isArray(block.nodes) || !Array.isArray(block.edges)) {
          errors.push(`Diagram block '${block.id}' is missing nodes or edges array`);
        }
        break;
      case 'quiz':
        this.validateQuizBlock(block, errors);
        break;
      default:
        errors.push(`Unsupported block type '${(block as any).type}' in block '${(block as any).id}'`);
    }
  }

  private validateQuizBlock(quiz: QuizBlock, errors: string[]): void {
    if (!quiz.question || quiz.question.trim().length === 0) {
      errors.push(`Quiz block '${quiz.id}' has an empty question`);
    }

    if (!quiz.answerSpec) {
      errors.push(`Quiz block '${quiz.id}' is missing mandatory 'answerSpec'`);
      return;
    }

    if (quiz.answerSpec.type === 'single_choice') {
      if (!quiz.answerSpec.correctOptionId) {
        errors.push(`Quiz single_choice block '${quiz.id}' is missing 'correctOptionId'`);
      }
      if (!Array.isArray(quiz.options) || quiz.options.length < 2) {
        errors.push(`Quiz single_choice block '${quiz.id}' must provide at least 2 options`);
      }
    } else if (quiz.answerSpec.type === 'multiple_choice') {
      if (!Array.isArray(quiz.answerSpec.correctOptionIds) || quiz.answerSpec.correctOptionIds.length === 0) {
        errors.push(`Quiz multiple_choice block '${quiz.id}' must provide at least 1 correct option ID`);
      }
    } else if (quiz.answerSpec.type === 'open') {
      if (!quiz.answerSpec.rubric || !Array.isArray(quiz.answerSpec.rubric.concepts)) {
        errors.push(`Quiz open block '${quiz.id}' must provide a rubric with concepts array`);
      }
    }
  }
}
