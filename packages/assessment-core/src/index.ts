export type AssessmentOutcome = 'correct' | 'partial' | 'incorrect';
export type ObjectiveKind = 'single' | 'multiple';

export interface ObjectiveQuestion {
  type?: ObjectiveKind;
  answerType?: ObjectiveKind;
  correctAnswer?: string | number;
  correctAnswers?: readonly (string | number)[];
  choices?: readonly (string | number)[];
}

export interface AssessmentEvaluation {
  result: AssessmentOutcome;
  score: number;
  evidenceConfidence: number;
  masteryProbability?: number;
  confidence?: number;
  feedback: string;
}

export interface OpenAnswerRubric {
  expectedKeywords?: readonly string[];
  keywords?: readonly string[];
  referenceAnswer?: string;
  minScoreForCorrect?: number;
  minScoreForPartial?: number;
}

/** Deterministic evaluator; deliberately does not call an LLM or network. */
export class AssessmentEvaluator {
  evaluateObjective(question: ObjectiveQuestion, answer: unknown): AssessmentEvaluation {
    const expected = question.correctAnswers ?? (question.correctAnswer === undefined ? [] : [question.correctAnswer]);
    const multiple = (question.type ?? question.answerType) === 'multiple' || expected.length > 1;
    const actual = Array.isArray(answer) ? answer : [answer];
    const normalizedExpected = expected.map(normalizeAnswer);
    const normalizedActual = actual.map(normalizeAnswer);
    const exact = normalizedExpected.length === normalizedActual.length && normalizedExpected.every((value, index) => value === normalizedActual[index]);
    if (exact) return evaluation('correct', 1, 'Correct.', 1.0);
    if (!multiple) return evaluation('incorrect', 0, 'That answer is not correct.', 1.0);

    const expectedSet = new Set(normalizedExpected);
    const actualSet = new Set(normalizedActual);
    const overlap = normalizedActual.filter((value) => expectedSet.has(value)).length;
    const wrong = normalizedActual.some((value) => !expectedSet.has(value));
    const score = expectedSet.size === 0 ? 0 : overlap / expectedSet.size;
    if (score > 0 && !wrong) return evaluation('partial', score, 'Partially correct; include all correct choices.', 1.0);
    return evaluation('incorrect', score, 'That selection is not correct.', 1.0);
  }

  evaluateOpenAnswer(answer: string, rubric: OpenAnswerRubric = {}): AssessmentEvaluation {
    const text = normalizeText(answer);
    const keywords = rubric.expectedKeywords ?? rubric.keywords ?? extractKeywords(rubric.referenceAnswer ?? '');
    const expected = keywords.map(normalizeText).filter(Boolean);
    const textTokens = tokenize(text);
    const matched = expected.filter((keyword) => containsKeyword(textTokens, keyword));
    const score = expected.length === 0 ? (text.length > 0 ? 1 : 0) : matched.length / expected.length;
    const correctAt = rubric.minScoreForCorrect ?? 0.8;
    const partialAt = rubric.minScoreForPartial ?? 0.4;
    if (score >= correctAt) return evaluation('correct', score, 'Your answer addresses the key ideas.', 1.0);
    if (score >= partialAt) return evaluation('partial', score, 'Your answer addresses some key ideas; add the missing ones.', 1.0);
    return evaluation('incorrect', score, 'Your answer is missing the key ideas.', 1.0);
  }

  evaluate(question: ObjectiveQuestion | OpenAnswerRubric, answer: unknown): AssessmentEvaluation {
    if ('correctAnswer' in question || 'correctAnswers' in question || 'answerType' in question || 'type' in question) {
      return this.evaluateObjective(question as ObjectiveQuestion, answer);
    }
    return this.evaluateOpenAnswer(String(answer ?? ''), question as OpenAnswerRubric);
  }
}

function normalizeAnswer(value: unknown): string {
  return normalizeText(String(value ?? ''));
}
function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter(Boolean);
}
function containsKeyword(textTokens: string[], keyword: string): boolean {
  const keywordTokens = tokenize(keyword);
  if (keywordTokens.length === 0) return false;
  return textTokens.some((_, index) =>
    keywordTokens.every((token, offset) => tokenMatches(textTokens[index + offset], token))
  );
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  return actual === expected || actual === `${expected}s` || actual === `${expected}es`;
}

function extractKeywords(reference: string): string[] {
  return [...new Set(normalizeText(reference).split(/[^a-z0-9]+/).filter((word) => word.length > 2))];
}

function evaluation(
  result: AssessmentOutcome,
  score: number,
  feedback: string,
  evidenceConfidence: number = 1.0
): AssessmentEvaluation {
  return { result, score, evidenceConfidence, confidence: evidenceConfidence, feedback };
}

export * from './mastery/beta-mastery-aggregator.ts';

