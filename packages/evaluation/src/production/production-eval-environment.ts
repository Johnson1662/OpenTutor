import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import {
  AgentSessionRepository,
  CourseRepository,
  DiagnosisRepository,
  EventRepository,
  LearningEvidenceRepository,
  LessonRepository,
  MisconceptionRepository,
  KnowledgeRepository,
  SessionRepository,
  TraceRepository,
  createDatabase,
  seedDatabase,
} from '@opentutor/database';
import type { Lesson, LearningPathNode } from '@opentutor/protocol';
import {
  FakeArtifactSynthesizer,
  FakeKnowledgeAnalyzer,
  LivingKnowledgeCompiler,
  ModelArtifactSynthesizer,
  ModelKnowledgeAnalyzer,
  SearchService,
} from '@opentutor/knowledge-core';
import {
  DefaultModelExecutionService,
  ModelPreferencesRepository,
  ModelSelectionService,
  PiModelDriver,
  RoleModelResolver,
  SessionModelResolver,
} from '@opentutor/model-runtime';
import { DomainToolsExecutor } from '@opentutor/tutor-tools';
import { LearningSessionCoordinator, ModelLessonGenerator } from '@opentutor/lesson-core';
import { ModelProbeGenerator } from '@opentutor/learning-core';
import { PiTutorRuntime } from '@opentutor/agent-runtime';
import { EventBus } from '../../../../apps/server/src/events/event-bus.ts';
import { AssessmentService } from '../../../../apps/server/src/services/assessment-service.ts';
import { DiagnosticLearningCoordinator } from '../../../../apps/server/src/services/diagnostic-learning-coordinator.ts';
import { KnowledgeService } from '../../../../apps/server/src/services/knowledge-service.ts';
import { LearningProgressService } from '../../../../apps/server/src/services/learning-progress-service.ts';
import { LessonService } from '../../../../apps/server/src/services/lesson-service.ts';
import { SessionService } from '../../../../apps/server/src/services/session-service.ts';
import type { ProductionTutorDomainInput, ProductionTutorScenarioInput } from '../tutor/tutor-eval-suite.ts';

export type ProductionKnowledgePreparation = 'real' | 'fixture';

export interface ProductionEvalEnvironmentOptions {
  bundle: ProductionTutorDomainInput;
  scenario: ProductionTutorScenarioInput;
  modelRuntime: any;
  knowledgePreparation?: ProductionKnowledgePreparation;
}

export interface ProductionEvalEnvironment {
  db: Database;
  modelRuntime: any;
  tutorRuntime: PiTutorRuntime;
  toolsExecutor: DomainToolsExecutor;
  sessionRepo: SessionRepository;
  lessonRepo: LessonRepository;
  knowledgeService: KnowledgeService;
  searchService: SearchService;
  sessionId: string;
  lessonId: string;
  courseId: string;
  dispose(): Promise<void>;
}

function scopedId(prefix: string, domain: string, scenarioId: string, suffix = ''): string {
  const safe = `${domain}-${scenarioId}-${suffix}`.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-');
  return `${prefix}-${safe}-${randomUUID().slice(0, 8)}`;
}

function ensureKnowledgeNode(db: Database, id: string, title: string, description: string): void {
  db.prepare(
    `INSERT INTO knowledge_nodes (id, title, description, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description`
  ).run(id, title, description, new Date().toISOString());
}

function ensurePrerequisiteEdge(db: Database, fromNodeId: string, toNodeId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
     VALUES (?, ?, 'prerequisite', ?)`
  ).run(fromNodeId, toNodeId, new Date().toISOString());
}

function cloneEvalPath(
  db: Database,
  sourcePath: LearningPathNode[] | undefined,
  domain: string,
  scenarioId: string,
  activeNodeId: string,
  activeTitle: string,
  sourceText: string
): LearningPathNode[] {
  const source = sourcePath && sourcePath.length > 0
    ? sourcePath
    : [{ id: 'main', knowledgeNodeId: activeNodeId, title: activeTitle, type: 'main' as const, status: 'current' as const, position: 0 }];
  const path = source.map((node, index) => {
    const knowledgeNodeId = index === source.findIndex((candidate) => candidate.status === 'current')
      ? activeNodeId
      : node.knowledgeNodeId;
    ensureKnowledgeNode(db, knowledgeNodeId, knowledgeNodeId.replace(/-/g, ' '), sourceText.slice(0, 500));
    return {
      ...node,
      id: scopedId('eval-path', domain, scenarioId, node.id),
      knowledgeNodeId,
      title: index === source.findIndex((candidate) => candidate.status === 'current') ? activeTitle : node.title,
      position: index,
    };
  });
  if (!path.some((node) => node.status === 'current')) {
    path[0] = { ...path[0]!, status: 'current' };
  }
  return path;
}

export async function createProductionTutorEvalEnvironment(
  options: ProductionEvalEnvironmentOptions
): Promise<ProductionEvalEnvironment> {
  const { bundle, scenario, modelRuntime } = options;
  const preparation = options.knowledgePreparation ?? 'real';
  const db = createDatabase(':memory:');
  seedDatabase(db);

  const courseId = scopedId('eval-course', bundle.domain, scenario.id);
  const lessonId = scopedId('eval-lesson', bundle.domain, scenario.id);
  const sessionId = scopedId('eval-session', bundle.domain, scenario.id);
  const activeNodeId = scenario.contextTopic;
  const prerequisiteNodeId = scopedId('eval-prerequisite', bundle.domain, scenario.id);
  const activeTitle = scenario.contextTopic.replace(/-/g, ' ');
  const now = new Date().toISOString();

  try {
    const courseRepo = new CourseRepository(db);
    courseRepo.createCourse({
      id: courseId,
      title: `${bundle.domain} Production Evaluation`,
      description: `Persisted production evaluation course for ${scenario.id}.`,
      compileStatus: 'ready',
    });

    ensureKnowledgeNode(db, activeNodeId, activeTitle, bundle.sourceText.slice(0, 500));
    ensureKnowledgeNode(db, prerequisiteNodeId, `${activeTitle} prerequisite`, `Prerequisite for ${activeTitle}.`);
    ensurePrerequisiteEdge(db, prerequisiteNodeId, activeNodeId);
    db.prepare(
      `INSERT OR IGNORE INTO course_nodes (course_id, knowledge_node_id, role, importance, position, metadata)
       VALUES (?, ?, 'main', 1.0, 0, ?)`
    ).run(courseId, activeNodeId, JSON.stringify({ scenarioId: scenario.id }));
    db.prepare(
      `INSERT OR IGNORE INTO course_nodes (course_id, knowledge_node_id, role, importance, position, metadata)
       VALUES (?, ?, 'prerequisite', 1.0, 1, ?)`
    ).run(courseId, prerequisiteNodeId, JSON.stringify({ scenarioId: scenario.id }));

    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const sessionRepo = new SessionRepository(db);
    const knowledgeRepo = new KnowledgeRepository(db);
    const evidenceRepo = new LearningEvidenceRepository(db);
    const diagnosisRepo = new DiagnosisRepository(db);
    const misconceptionRepo = new MisconceptionRepository(db);
    const eventRepo = new EventRepository(db);
    const agentSessionRepo = new AgentSessionRepository(db);
    const preferencesRepo = new ModelPreferencesRepository(db);
    const eventBus = new EventBus(eventRepo);

    const modelSelectionService = new ModelSelectionService(modelRuntime, preferencesRepo);
    const availableModels = await modelRuntime.getAvailable();
    const preferredProvider = process.env.OPENTUTOR_DEFAULT_PROVIDER;
    const preferredModel = process.env.OPENTUTOR_DEFAULT_MODEL;
    const firstAvailableModel = availableModels.find((model: { provider: string; id: string }) =>
      (!preferredProvider || model.provider === preferredProvider) &&
      (!preferredModel || model.id === preferredModel)
    ) ?? availableModels[0];
    if (firstAvailableModel) {
      preferencesRepo.setPreferences('default-user', {
        defaultProviderId: firstAvailableModel.provider,
        defaultModelId: firstAvailableModel.id,
        thinkingLevel: 'off',
      });
    }
    const sessionModelResolver = new SessionModelResolver(modelSelectionService, modelRuntime, agentSessionRepo);
    const roleModelResolver = new RoleModelResolver(modelSelectionService, modelRuntime, preferencesRepo);
    const modelExecutionService = new DefaultModelExecutionService(roleModelResolver, new PiModelDriver(modelRuntime));

    const knowledgeCompiler = preparation === 'real'
      ? new LivingKnowledgeCompiler(
          db,
          new ModelKnowledgeAnalyzer(modelExecutionService),
          new ModelArtifactSynthesizer(modelExecutionService)
        )
      : new LivingKnowledgeCompiler(db, new FakeKnowledgeAnalyzer(), new FakeArtifactSynthesizer());
    await knowledgeCompiler.ingestAndCompile({
      documentId: scopedId('eval-document', bundle.domain, scenario.id),
      title: `${bundle.domain} Evaluation Source`,
      content: bundle.sourceText,
    });

    const activeNodeRow = db.prepare(
      `SELECT id, title FROM knowledge_nodes
       WHERE id = ? OR lower(title) LIKE ?
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
       LIMIT 1`
    ).get(activeNodeId, `%${activeTitle.toLowerCase()}%`, activeNodeId) as { id: string; title: string } | undefined;
    const resolvedActiveNodeId = activeNodeRow?.id ?? activeNodeId;
    ensureKnowledgeNode(db, resolvedActiveNodeId, activeNodeRow?.title ?? activeTitle, bundle.sourceText.slice(0, 500));
    ensurePrerequisiteEdge(db, prerequisiteNodeId, resolvedActiveNodeId);

    if (!knowledgeCompiler.retrieval.artifactRead(resolvedActiveNodeId)) {
      await knowledgeCompiler.artifacts.compile(resolvedActiveNodeId, activeTitle);
    }

    const lesson: Lesson = {
      schemaVersion: '1.0',
      id: lessonId,
      courseId,
      knowledgeNodeId: resolvedActiveNodeId,
      title: `${activeTitle} Evaluation Lesson`,
      objective: `Evaluate tutor behavior while teaching ${activeTitle}.`,
      version: 1,
      status: 'active',
      blocks: [
        {
          id: scopedId('eval-block', bundle.domain, scenario.id, 'context'),
          type: 'text',
          variant: 'paragraph',
          content: bundle.sourceText.slice(0, 1000),
        },
        {
          id: scopedId('eval-block', bundle.domain, scenario.id, 'quiz'),
          type: 'quiz',
          answerType: 'text',
          question: `Explain one important idea about ${activeTitle}.`,
          answerSpec: {
            type: 'open',
            rubric: {
              concepts: [activeTitle.split(' ')[0], 'attention', 'model'],
            },
          },
        },
      ],
    };
    lessonRepo.saveLesson(lesson);

    const prototypePath = sessionRepo.getSessionSnapshot('prototype')?.path;
    const path = cloneEvalPath(db, prototypePath, bundle.domain, scenario.id, resolvedActiveNodeId, activeTitle, bundle.sourceText);
    sessionRepo.createSession({
      id: sessionId,
      userId: `eval-user-${bundle.domain}`,
      courseId,
      activeLessonId: lessonId,
      pathVersion: 1,
      path,
    });

    const searchService = knowledgeCompiler.retrieval;
    const knowledgeService = new KnowledgeService(
      knowledgeRepo,
      searchService,
      eventBus,
      evidenceRepo,
      undefined,
      db,
      misconceptionRepo,
      diagnosisRepo
    );
    const lessonService = new LessonService(lessonRepo, eventBus);
    const learningSessionCoordinator = new LearningSessionCoordinator(
      db,
      knowledgeCompiler.artifacts,
      new ModelLessonGenerator(modelExecutionService)
    );
    const sessionService = new SessionService(sessionRepo, eventBus, learningSessionCoordinator);
    const progressService = new LearningProgressService(sessionService, eventBus);
    const assessmentService = new AssessmentService(lessonService, knowledgeService, progressService);
    const diagnosticCoordinator = new DiagnosticLearningCoordinator({
      db,
      lessonService,
      sessionService,
      knowledgeService,
      assessmentService,
      progressService,
      misconceptionRepo,
      diagnosisRepo,
      eventBus,
      probeGenerator: new ModelProbeGenerator(modelExecutionService),
    });

    const toolsExecutor = new DomainToolsExecutor({
      lessonService,
      sessionService,
      knowledgeService,
      diagnosisRepository: diagnosisRepo,
      probeService: {
        requestProbe: (requestedSessionId, params) => diagnosticCoordinator.requestProbe({
          sessionId: requestedSessionId,
          prerequisiteNodeId: params.prerequisiteNodeId,
          reason: params.reason,
        }),
      },
    });
    const tutorRuntime = new PiTutorRuntime(toolsExecutor, traceRepo, {
      modelRuntime,
      sessionModelResolver,
    });

    return {
      db,
      modelRuntime,
      tutorRuntime,
      toolsExecutor,
      sessionRepo,
      lessonRepo,
      knowledgeService,
      searchService,
      sessionId,
      lessonId,
      courseId,
      async dispose() {
        try {
          await tutorRuntime.disposeSession(sessionId);
        } finally {
          db.close();
        }
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
