export type AssessmentOutcome = 'correct' | 'partial' | 'incorrect';
export type MasteryStatus = 'unknown' | 'learning' | 'weak' | 'mastered';

export interface MasteryState {
  confidence: number;
  status?: MasteryStatus;
}

export interface MasteryPolicyOptions {
  correctStep?: number;
  partialStep?: number;
  incorrectStep?: number;
  learningThreshold?: number;
  weakThreshold?: number;
  masteredThreshold?: number;
}

/** A small, deterministic rule: evidence moves confidence, thresholds map it to a status. */
export class MasteryPolicy {
  private readonly correctStep: number;
  private readonly partialStep: number;
  private readonly incorrectStep: number;
  private readonly learningThreshold: number;
  private readonly weakThreshold: number;
  private readonly masteredThreshold: number;

  constructor(options: MasteryPolicyOptions = {}) {
    this.correctStep = options.correctStep ?? 0.25;
    this.partialStep = options.partialStep ?? 0.10;
    this.incorrectStep = options.incorrectStep ?? 0.25;
    this.weakThreshold = options.weakThreshold ?? 0.20;
    this.learningThreshold = options.learningThreshold ?? 0.50;
    this.masteredThreshold = options.masteredThreshold ?? 0.80;
    if (!(this.weakThreshold >= 0 && this.weakThreshold <= this.learningThreshold && this.learningThreshold < this.masteredThreshold && this.masteredThreshold <= 1)) {
      throw new RangeError('Mastery thresholds must be ordered between 0 and 1');
    }
  }

  statusForConfidence(confidence: number): MasteryStatus {
    const value = clamp(confidence);
    if (value >= this.masteredThreshold) return 'mastered';
    if (value >= this.learningThreshold) return 'learning';
    if (value >= this.weakThreshold) return 'weak';
    return 'unknown';
  }

  /** Alias useful to callers that model status as a pure mapping. */
  status(confidence: number): MasteryStatus {
    return this.statusForConfidence(confidence);
  }

  updateConfidence(confidence: number, outcome: AssessmentOutcome): number {
    const current = clamp(confidence);
    switch (outcome) {
      case 'correct':
        return clamp(current + this.correctStep);
      case 'partial':
        return clamp(current + this.partialStep);
      case 'incorrect':
        return clamp(current - this.incorrectStep);
      default:
        return current;
    }
  }

  apply(state: MasteryState, outcome: AssessmentOutcome): MasteryState {
    const confidence = this.updateConfidence(state.confidence, outcome);
    return { confidence, status: this.statusForConfidence(confidence) };
  }

  update(state: MasteryState, outcome: AssessmentOutcome): MasteryState {
    return this.apply(state, outcome);
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

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
  confidence: number;
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
    if (exact) return evaluation('correct', 1, 'Correct.');
    if (!multiple) return evaluation('incorrect', 0, 'That answer is not correct.');

    const expectedSet = new Set(normalizedExpected);
    const actualSet = new Set(normalizedActual);
    const overlap = normalizedActual.filter((value) => expectedSet.has(value)).length;
    const wrong = normalizedActual.some((value) => !expectedSet.has(value));
    const score = expectedSet.size === 0 ? 0 : overlap / expectedSet.size;
    if (score > 0 && !wrong) return evaluation('partial', score, 'Partially correct; include all correct choices.');
    return evaluation('incorrect', score, 'That selection is not correct.');
  }

  evaluateOpenAnswer(answer: string, rubric: OpenAnswerRubric = {}): AssessmentEvaluation {
    const text = normalizeText(answer);
    const keywords = rubric.expectedKeywords ?? rubric.keywords ?? extractKeywords(rubric.referenceAnswer ?? '');
    const expected = keywords.map(normalizeText).filter(Boolean);
    const matched = expected.filter((keyword) => text.includes(keyword));
    const score = expected.length === 0 ? (text.length > 0 ? 1 : 0) : matched.length / expected.length;
    const correctAt = rubric.minScoreForCorrect ?? 0.8;
    const partialAt = rubric.minScoreForPartial ?? 0.4;
    if (score >= correctAt) return evaluation('correct', score, 'Your answer addresses the key ideas.');
    if (score >= partialAt) return evaluation('partial', score, 'Your answer addresses some key ideas; add the missing ones.');
    return evaluation('incorrect', score, 'Your answer is missing the key ideas.');
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

function extractKeywords(reference: string): string[] {
  return [...new Set(normalizeText(reference).split(/[^a-z0-9]+/).filter((word) => word.length > 2))];
}

function evaluation(result: AssessmentOutcome, score: number, feedback: string): AssessmentEvaluation {
  return { result, score, confidence: score, feedback };
}

export interface KnowledgeNodeLike {
  id: string;
  title?: string;
  [key: string]: unknown;
}

export interface PrerequisiteEdge {
  from: string;
  to: string;
  relationType?: string;
  fromNodeId?: string;
  toNodeId?: string;
}

export interface CoursePlan<T extends KnowledgeNodeLike = KnowledgeNodeLike> {
  nodes: T[];
  nodeIds: string[];
  edges: PrerequisiteEdge[];
}

/** Compiles a goal subgraph without mutating repository data. */
export class CourseCompiler {
  compile<T extends KnowledgeNodeLike>(
    nodes: readonly T[],
    edges: readonly PrerequisiteEdge[],
    goalNodeIds: readonly string[] = nodes.map((node) => node.id),
    masteredNodeIds: ReadonlySet<string> | readonly string[] = []
  ): CoursePlan<T> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const normalizedEdges = edges
      .map((edge) => ({ ...edge, from: edge.fromNodeId ?? edge.from, to: edge.toNodeId ?? edge.to }))
      .filter((edge) => edge.relationType === undefined || edge.relationType === 'prerequisite')
      .filter((edge) => byId.has(edge.from) && byId.has(edge.to));
    const incoming = new Map<string, string[]>();
    for (const edge of normalizedEdges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    const included = new Set<string>();
    const visit = (id: string): void => {
      if (included.has(id) || !byId.has(id)) return;
      included.add(id);
      for (const prerequisite of incoming.get(id) ?? []) visit(prerequisite);
    };
    for (const goal of goalNodeIds) visit(goal);

    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const indegree = new Map<string, number>([...included].map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const edge of normalizedEdges) {
      if (!included.has(edge.from) || !included.has(edge.to)) continue;
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
    const ready = [...included].filter((id) => indegree.get(id) === 0).sort((a, b) => (order.get(a)! - order.get(b)!));
    const sorted: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      sorted.push(id);
      for (const next of outgoing.get(id) ?? []) {
        const count = indegree.get(next)! - 1;
        indegree.set(next, count);
        if (count === 0) {
          ready.push(next);
          ready.sort((a, b) => order.get(a)! - order.get(b)!);
        }
      }
    }
    if (sorted.length !== included.size) throw new Error('Prerequisite graph contains a cycle');

    const mastered = masteredNodeIds instanceof Set ? masteredNodeIds : new Set(masteredNodeIds);
    const filtered = sorted.filter((id) => !mastered.has(id));
    return { nodes: filtered.map((id) => byId.get(id)!), nodeIds: filtered, edges: normalizedEdges.filter((edge) => filtered.includes(edge.from) && filtered.includes(edge.to)) };
  }

  compileNodeIds(
    nodes: readonly KnowledgeNodeLike[],
    edges: readonly PrerequisiteEdge[],
    goalNodeIds: readonly string[],
    masteredNodeIds: ReadonlySet<string> | readonly string[] = []
  ): string[] {
    return this.compile(nodes, edges, goalNodeIds, masteredNodeIds).nodeIds;
  }
}

export * from './mastery/beta-mastery-aggregator.ts';

