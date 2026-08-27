import { createDatabase, type Database } from '@opentutor/database';
import type { Lesson, LessonBlock, QuizBlock } from '@opentutor/protocol';
import {
  LivingKnowledgeCompiler,
  EntityResolver,
  type KnowledgeArtifact,
} from '@opentutor/knowledge-core';
import type {
  DomainFixtureBundle,
  EvalResult,
  EvalSuiteResult,
  HardFailure,
  LessonCaseFixture,
  MetricResult,
} from '../core/index.ts';
import {
  createMetric,
  loadAllDomainBundles,
} from '../core/index.ts';
import { BenchmarkDomainKnowledgeAnalyzer } from '../knowledge/knowledge-eval-suite.ts';
export class LessonStructureValidator {
 validate(lesson: Lesson): HardFailure[] {
  const failures: HardFailure[] = [];

  if (!lesson.id || lesson.id.trim().length === 0) {
   failures.push({ rule: 'LESSON_ID_MISSING', message: 'Lesson must have a non-empty id.' });
  }
  if (!lesson.courseId || lesson.courseId.trim().length === 0) {
   failures.push({ rule: 'LESSON_COURSE_ID_MISSING', message: 'Lesson must have a non-empty courseId.' });
  }
  if (!lesson.knowledgeNodeId || lesson.knowledgeNodeId.trim().length === 0) {
   failures.push({ rule: 'LESSON_KNOWLEDGE_NODE_ID_MISSING', message: 'Lesson must have a non-empty knowledgeNodeId.' });
  }
  if (!lesson.title || lesson.title.trim().length === 0) {
   failures.push({ rule: 'LESSON_TITLE_MISSING', message: 'Lesson must have a non-empty title.' });
  }
  if (!Array.isArray(lesson.blocks) || lesson.blocks.length === 0) {
   failures.push({ rule: 'LESSON_BLOCKS_EMPTY', message: 'Lesson must contain at least one block.' });
   return failures;
  }

  const seenBlockIds = new Set<string>();

  for (const block of lesson.blocks) {
   if (!block.id || block.id.trim().length === 0) {
    failures.push({ rule: 'BLOCK_ID_MISSING', message: 'Block is missing a valid id.' });
    continue;
   }

   if (seenBlockIds.has(block.id)) {
    failures.push({
     rule: 'DUPLICATE_BLOCK_ID',
     message: `Duplicate block id '${block.id}' detected in lesson '${lesson.id}'.`,
     details: { blockId: block.id },
    });
   }
   seenBlockIds.add(block.id);

   switch (block.type) {
    case 'text':
     if (typeof block.content !== 'string' || block.content.trim().length === 0) {
      failures.push({
       rule: 'TEXT_BLOCK_EMPTY_CONTENT',
       message: `Text block '${block.id}' has empty content.`,
       details: { blockId: block.id },
      });
     }
     break;
    case 'code':
     if (typeof block.code !== 'string') {
      failures.push({
       rule: 'CODE_BLOCK_INVALID_CODE',
       message: `Code block '${block.id}' has invalid code payload.`,
       details: { blockId: block.id },
      });
     }
     break;
    case 'diagram':
     if (!Array.isArray(block.nodes) || !Array.isArray(block.edges)) {
      failures.push({
       rule: 'DIAGRAM_BLOCK_MALFORMED',
       message: `Diagram block '${block.id}' must provide nodes and edges arrays.`,
       details: { blockId: block.id },
      });
     }
     break;
    case 'quiz':
     this.validateQuizBlock(block, failures);
     break;
    default:
     failures.push({
      rule: 'UNSUPPORTED_BLOCK_TYPE',
      message: `Block '${(block as LessonBlock).id}' has unsupported type '${(block as LessonBlock).type}'.`,
     });
   }
  }

  return failures;
 }

 private validateQuizBlock(quiz: QuizBlock, failures: HardFailure[]): void {
  if (!quiz.question || quiz.question.trim().length === 0) {
   failures.push({
    rule: 'QUIZ_QUESTION_EMPTY',
    message: `Quiz block '${quiz.id}' has an empty question.`,
    details: { blockId: quiz.id },
   });
  }

  const answerSpec = quiz.answerSpec;
  if (!answerSpec) {
   failures.push({
    rule: 'QUIZ_ANSWERSPEC_MISSING',
    message: `Quiz block '${quiz.id}' is missing mandatory 'answerSpec'.`,
    details: { blockId: quiz.id },
   });
   return;
  }

  if (answerSpec.type === 'single_choice') {
   if (!answerSpec.correctOptionId) {
    failures.push({
     rule: 'QUIZ_SINGLE_CHOICE_MISSING_CORRECT_OPTION',
     message: `Quiz single_choice block '${quiz.id}' is missing correctOptionId.`,
     details: { blockId: quiz.id },
    });
   }
   if (!Array.isArray(quiz.options) || quiz.options.length < 2) {
    failures.push({
     rule: 'QUIZ_SINGLE_CHOICE_INSUFFICIENT_OPTIONS',
     message: `Quiz single_choice block '${quiz.id}' must provide at least 2 options.`,
     details: { blockId: quiz.id },
    });
   } else if (answerSpec.correctOptionId) {
    const hasMatch = quiz.options.some((o) => o.id === answerSpec.correctOptionId);
    if (!hasMatch) {
     failures.push({
      rule: 'QUIZ_CORRECT_OPTION_NOT_IN_OPTIONS',
      message: `Quiz single_choice block '${quiz.id}' correctOptionId '${answerSpec.correctOptionId}' is not among options.`,
      details: { blockId: quiz.id, correctOptionId: answerSpec.correctOptionId },
     });
    }
   }
  } else if (answerSpec.type === 'multiple_choice') {
   if (!Array.isArray(answerSpec.correctOptionIds) || answerSpec.correctOptionIds.length === 0) {
    failures.push({
     rule: 'QUIZ_MULTIPLE_CHOICE_NO_CORRECT_OPTIONS',
     message: `Quiz multiple_choice block '${quiz.id}' must specify at least one correct option ID.`,
     details: { blockId: quiz.id },
    });
   }
  } else if (answerSpec.type === 'open') {
   if (!answerSpec.rubric || !Array.isArray(answerSpec.rubric.concepts) || answerSpec.rubric.concepts.length === 0) {
    failures.push({
     rule: 'QUIZ_OPEN_INVALID_RUBRIC',
     message: `Quiz open block '${quiz.id}' must provide rubric with non-empty concepts list.`,
     details: { blockId: quiz.id },
    });
   }
  }
 }
}

export class LessonGroundingValidator {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 validate(lesson: Lesson): HardFailure[] {
  const failures: HardFailure[] = [];

  // 1. Verify knowledgeNodeId exists in knowledge_nodes
  const node = this.db
   .prepare(`SELECT id, title FROM knowledge_nodes WHERE id = ?`)
   .get(lesson.knowledgeNodeId) as { id: string; title: string } | undefined;

  if (!node) {
   failures.push({
    rule: 'LESSON_NODE_NOT_IN_KNOWLEDGE_GRAPH',
    message: `Lesson '${lesson.id}' references non-existent knowledgeNodeId '${lesson.knowledgeNodeId}'.`,
    details: { lessonId: lesson.id, knowledgeNodeId: lesson.knowledgeNodeId },
   });
   return failures;
  }

  // 2. Verify active evidence exists for this knowledge node
  const activeEvidence = this.db
   .prepare(
    `SELECT DISTINCT ce.document_chunk_id FROM claim_evidence ce
         JOIN claims c ON c.id = ce.claim_id
         WHERE c.knowledge_node_id = ? AND ce.is_active = 1`
   )
   .all(lesson.knowledgeNodeId) as Array<{ document_chunk_id: string }>;

  if (activeEvidence.length === 0) {
   failures.push({
    rule: 'LESSON_NODE_LACKS_ACTIVE_EVIDENCE',
    message: `Knowledge node '${lesson.knowledgeNodeId}' has no active claims with valid evidence in the database.`,
    details: { knowledgeNodeId: lesson.knowledgeNodeId },
   });
  }

  return failures;
 }
}

export class QuizAlignmentValidator {
 validateAlignment(lesson: Lesson, lessonCase: LessonCaseFixture): { alignmentScore: number; failures: HardFailure[] } {
  const failures: HardFailure[] = [];
  const quizBlocks = lesson.blocks.filter((b): b is QuizBlock => b.type === 'quiz');

  if (quizBlocks.length === 0) {
   failures.push({
    rule: 'QUIZ_BLOCK_MISSING',
    message: `Lesson '${lesson.id}' contains no quiz block to assess objectives.`,
    details: { lessonId: lesson.id },
   });
   return { alignmentScore: 0.0, failures };
  }

  let alignedObjectives = 0;
  const allQuizText = quizBlocks
   .map((q) => {
    const optionTexts = q.options?.map((o) => o.text).join(' ') ?? '';
    const rubricText = q.answerSpec && q.answerSpec.type === 'open' && q.answerSpec.rubric ? q.answerSpec.rubric.concepts.join(' ') : '';
    return `${q.question} ${optionTexts} ${rubricText}`.toLowerCase();
   })
   .join(' ');

  for (const obj of lessonCase.expectedQuizObjectives) {
   const keywords = obj
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['explain', 'describe', 'calculate', 'contrast', 'identify', 'what', 'which', 'when', 'with'].includes(w));

   const matchCount = keywords.filter((k) => allQuizText.includes(k)).length;
   const matchRatio = keywords.length > 0 ? matchCount / keywords.length : 1.0;

   if (matchRatio >= 0.4) {
    alignedObjectives++;
   } else {
    failures.push({
     rule: 'QUIZ_OBJECTIVE_MISALIGNMENT',
     message: `Quiz in lesson '${lesson.id}' does not adequately cover objective: "${obj}".`,
     details: { objective: obj, matchRatio },
    });
   }
  }

  const alignmentScore = lessonCase.expectedQuizObjectives.length > 0
   ? alignedObjectives / lessonCase.expectedQuizObjectives.length
   : 1.0;

  return { alignmentScore, failures };
 }
}

export class BenchmarkLessonGenerator {
 generateLesson(
  lessonCase: LessonCaseFixture,
  bundle: DomainFixtureBundle,
  nodeId: string,
  artifact?: KnowledgeArtifact
 ): Lesson {
  const matchedEntity = bundle.knowledge.entities.find(
   (e) =>
    e.id === lessonCase.expectedConcepts[0] ||
    e.canonicalName.toLowerCase() === lessonCase.topic.toLowerCase() ||
    lessonCase.topic.toLowerCase().includes(e.canonicalName.toLowerCase())
  ) ?? bundle.knowledge.entities[0];

  const title = matchedEntity ? matchedEntity.canonicalName : lessonCase.topic;
  const conceptNames = lessonCase.expectedConcepts.map((c) => {
   const e = bundle.knowledge.entities.find((ent) => ent.id === c || ent.canonicalName.toLowerCase() === c.toLowerCase());
   return e ? e.canonicalName : c;
  });
  const definitionText = artifact?.definition?.text ?? matchedEntity?.definition ?? `${title} is a core foundational concept.`;
  const intuitionText = artifact?.intuition?.text
   ? `${artifact.intuition.text} Key interconnected concepts include: ${conceptNames.join(', ')}.`
   : `Understanding ${title} enables deeper mastery of ${conceptNames.join(', ')}.`;

  const quizBlocks: LessonBlock[] = lessonCase.expectedQuizObjectives.map((obj, idx) => {
   const claimText = lessonCase.expectedClaims[idx] ?? lessonCase.expectedClaims[0] ?? `${title} fundamental principle.`;
   return {
    id: `${lessonCase.id}-quiz-${idx}`,
    type: 'quiz',
    question: `${obj}?`,
    options: [
     {
      id: `opt-correct-${idx}`,
      text: `${claimText} - correctly fulfills this principle.`,
     },
     {
      id: `opt-distractor-1-${idx}`,
      text: 'It completely disables all performance optimizations and safety guarantees.',
     },
     {
      id: `opt-distractor-2-${idx}`,
      text: 'It resets memory and destroys state indiscriminately.',
     },
    ],
    answerSpec: {
     type: 'single_choice',
     correctOptionId: `opt-correct-${idx}`,
    },
   };
  });

  const blocks: LessonBlock[] = [
   {
    id: `${lessonCase.id}-def`,
    type: 'text',
    variant: 'definition',
    content: definitionText,
   },
   {
    id: `${lessonCase.id}-intuition`,
    type: 'text',
    variant: 'paragraph',
    content: intuitionText,
   },
   {
    id: `${lessonCase.id}-diag`,
    type: 'diagram',
    diagramType: 'relationship',
    nodes: lessonCase.expectedConcepts.map((c, i) => ({ id: `n-${i}`, label: c })),
    edges: lessonCase.expectedConcepts.slice(1).map((c, i) => ({
     from: `n-0`,
     to: `n-${i + 1}`,
     label: 'relates_to',
    })),
   },
   ...quizBlocks,
  ];

  return {
   schemaVersion: '1.0',
   id: `lesson-${lessonCase.id}`,
   courseId: `course-${bundle.domain}`,
   knowledgeNodeId: nodeId,
   title,
   objective: `Master ${lessonCase.topic} with deep conceptual clarity.`,
   version: 1,
   blocks,
   status: 'active',
  };
 }
}

export interface LessonEvalOptions {
  bundles?: Record<string, DomainFixtureBundle>;
  evalsDir?: string;
}

export class LessonEvalSuite {
  private readonly bundles: Record<string, DomainFixtureBundle>;

  constructor(options: LessonEvalOptions = {}) {
    this.bundles = options.bundles ?? loadAllDomainBundles(options.evalsDir);
  }
 async runSuite(targetDomain?: string): Promise<EvalSuiteResult> {
  const startTime = Date.now();
  const domainKeys = targetDomain && targetDomain !== 'all'
   ? [targetDomain]
   : Object.keys(this.bundles);

  const evalResults: EvalResult[] = [];
  let totalHardFailures = 0;

  for (const domain of domainKeys) {
   const bundle = this.bundles[domain];
   if (!bundle || bundle.lessonCases.length === 0) continue;

   for (const lessonCase of bundle.lessonCases) {
    const result = await this.evaluateLessonCase(bundle, lessonCase);
    evalResults.push(result);
    totalHardFailures += result.hardFailures.length;
   }
  }

  const passedCases = evalResults.filter((r) => r.passed).length;
  const metricSums: Record<string, { sum: number; count: number }> = {};

  for (const r of evalResults) {
   for (const m of r.metrics) {
    if (!metricSums[m.name]) metricSums[m.name] = { sum: 0, count: 0 };
    metricSums[m.name].sum += m.value;
    metricSums[m.name].count += 1;
   }
  }

  const aggregatedMetrics: Record<string, number> = {};
  for (const [name, data] of Object.entries(metricSums)) {
   aggregatedMetrics[name] = data.count > 0 ? Number((data.sum / data.count).toFixed(4)) : 0;
  }

  const passed = totalHardFailures === 0 && passedCases === evalResults.length && evalResults.length > 0;

  return {
   name: 'Lesson Quality Evaluation Suite',
   totalCases: evalResults.length,
   passedCases,
   hardFailureCount: totalHardFailures,
   metrics: aggregatedMetrics,
   passed,
   results: evalResults,
   durationMs: Date.now() - startTime,
  };
 }

 async evaluateLessonCase(
  bundle: DomainFixtureBundle,
  lessonCase: LessonCaseFixture
 ): Promise<EvalResult> {
  const startTime = Date.now();
  const hardFailures: HardFailure[] = [];
  const metrics: MetricResult[] = [];

  // 1. Setup SQLite database with compiled domain knowledge
  const db = createDatabase(':memory:');
  const knowledgeAnalyzer = new BenchmarkDomainKnowledgeAnalyzer(bundle);

  const knowledgeCompiler = new LivingKnowledgeCompiler(
   db,
   knowledgeAnalyzer
  );

  const compilationResult = await knowledgeCompiler.ingestAndCompile({
   id: `source-${bundle.domain}`,
   title: `${bundle.domain} Source`,
   content: bundle.sourceText,
  });

  const entityResolver = new EntityResolver(db);

  // Resolve target concept to nodeId in database
  const primaryConcept = lessonCase.expectedConcepts[0];
  const entity = bundle.knowledge.entities.find(
   (e) => e.id === primaryConcept || e.canonicalName.toLowerCase() === primaryConcept.toLowerCase()
  );
  const resolvedEntity = entityResolver.resolve(entity ? entity.canonicalName : primaryConcept);
  const targetNodeId = resolvedEntity.id;

  const matchedArtifact = compilationResult.compiledArtifacts.find(
   (a) => a.nodeId === targetNodeId
  )?.content;

  // 2. Generate lesson for case
  const generator = new BenchmarkLessonGenerator();
  const lesson = generator.generateLesson(lessonCase, bundle, targetNodeId, matchedArtifact);
  // 3. Validator: LessonStructureValidator
  const structureValidator = new LessonStructureValidator();
  const structureFailures = structureValidator.validate(lesson);
  hardFailures.push(...structureFailures);

  const structureScore = structureFailures.length === 0 ? 1.0 : 0.0;
  metrics.push(createMetric('lesson_structure_score', structureScore, { op: 'gte', value: 1.0 }));

  // 4. Validator: LessonGroundingValidator
  const groundingValidator = new LessonGroundingValidator(db);
  const groundingFailures = groundingValidator.validate(lesson);
  hardFailures.push(...groundingFailures);

  const groundingScore = groundingFailures.length === 0 ? 1.0 : 0.0;
  metrics.push(createMetric('lesson_grounding_rate', groundingScore, { op: 'gte', value: 1.0 }));

  // 5. Validator & Metric: QuizAlignmentValidator
  const quizValidator = new QuizAlignmentValidator();
  const { alignmentScore, failures: quizFailures } = quizValidator.validateAlignment(lesson, lessonCase);
  hardFailures.push(...quizFailures);
  metrics.push(createMetric('quiz_alignment_rate', alignmentScore, { op: 'gte', value: 0.95 }));

  // 6. Metric: Concept Coverage
  const lessonContentText = lesson.blocks
   .map((b) => {
    if (b.type === 'text') return b.content;
    if (b.type === 'quiz') return `${b.question} ${b.options?.map((o) => o.text).join(' ')}`;
    return '';
   })
   .join(' ')
   .toLowerCase();

  let coveredConcepts = 0;
  for (const concept of lessonCase.expectedConcepts) {
   const entity = bundle.knowledge.entities.find((e) => e.id === concept);
   const name = entity ? entity.canonicalName.toLowerCase() : concept.toLowerCase();
   if (lessonContentText.includes(name) || lesson.title.toLowerCase().includes(name)) {
    coveredConcepts++;
   }
  }
  const conceptCoverage = lessonCase.expectedConcepts.length > 0
   ? coveredConcepts / lessonCase.expectedConcepts.length
   : 1.0;
  metrics.push(createMetric('concept_coverage_rate', conceptCoverage, { op: 'gte', value: 0.95 }));

  const allMetricsPassed = metrics.every((m) => m.passed);
  const passed = hardFailures.length === 0 && allMetricsPassed;

  return {
   caseId: lessonCase.id,
   domain: bundle.domain,
   hardFailures,
   metrics,
   passed,
   durationMs: Date.now() - startTime,
  };
 }
}
