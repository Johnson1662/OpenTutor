import http from 'node:http';
import {
  createDatabase,
  seedDatabase,
  LessonRepository,
  SessionRepository,
  KnowledgeRepository,
  LearningEvidenceRepository,
  EventRepository,
  TraceRepository,
  AgentSessionRepository,
  CourseRepository,
  MisconceptionRepository,
  DiagnosisRepository,
  SessionFrameRepository,
  type Database,
} from '@opentutor/database';
import { EventBus } from './events/event-bus.ts';
import { SessionService } from './services/session-service.ts';
import { LessonService } from './services/lesson-service.ts';
import { KnowledgeService } from './services/knowledge-service.ts';
import { AssessmentService } from './services/assessment-service.ts';
import { LearningProgressService } from './services/learning-progress-service.ts';
import { DiagnosticLearningCoordinator } from './services/diagnostic-learning-coordinator.ts';
import { ModelProbeGenerator } from '@opentutor/learning-core';
import { CourseService } from './services/course-service.ts';
import {
  SearchService,
  LivingKnowledgeCompiler,
  ModelKnowledgeAnalyzer,
  FakeKnowledgeAnalyzer,
  ModelArtifactSynthesizer,
  FakeArtifactSynthesizer,
} from '@opentutor/knowledge-core';
import {
  CourseCompiler,
  ModelGoalAnalyzer,
  FakeGoalAnalyzer,
} from '@opentutor/course-core';
import {
  LearningSessionCoordinator,
  ModelLessonGenerator,
  FakeLessonGenerator,
} from '@opentutor/lesson-core';
import {
  createOpenTutorModelRuntime,
  ProviderService,
  AuthService,
  ModelPreferencesRepository,
  ModelSelectionService,
  SessionModelResolver,
  RoleModelResolver,
  DefaultModelExecutionService,
  PiModelDriver,
  FakeModelDriver,
} from '@opentutor/model-runtime';
import { DomainToolsExecutor } from '@opentutor/tutor-tools';
import { PiTutorRuntime, type TutorRuntime } from '@opentutor/agent-runtime';
import { handleRequest, type RouteContext } from './api/router.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.OPENTUTOR_DB_PATH ?? 'opentutor.sqlite';

export async function createServerContext(
  dbPath: string = DB_PATH,
  customRuntime?: TutorRuntime
): Promise<{
  server: http.Server;
  context: RouteContext;
  db: Database;
  sessionRepo: SessionRepository;
  lessonRepo: LessonRepository;
  knowledgeRepo: KnowledgeRepository;
  evidenceRepo: LearningEvidenceRepository;
  courseRepo: CourseRepository;
  courseService: CourseService;
  preferencesRepo: ModelPreferencesRepository;
  misconceptionRepo?: MisconceptionRepository;
  diagnosisRepo?: DiagnosisRepository;
  diagnosticCoordinator?: DiagnosticLearningCoordinator;
  close: () => Promise<void>;
}> {
  const db = createDatabase(dbPath);
  seedDatabase(db);

  const lessonRepo = new LessonRepository(db);
  const sessionRepo = new SessionRepository(db);
  const knowledgeRepo = new KnowledgeRepository(db);
  const learningEvidenceRepo = new LearningEvidenceRepository(db);
  const courseRepo = new CourseRepository(db);
  const eventRepo = new EventRepository(db);
  const traceRepo = new TraceRepository(db);
  const agentSessionRepo = new AgentSessionRepository(db);
  const preferencesRepo = new ModelPreferencesRepository(db);
  const misconceptionRepo = new MisconceptionRepository(db);
  const diagnosisRepo = new DiagnosisRepository(db);
  const sessionFrameRepo = new SessionFrameRepository(db);
  const modelRuntime = await createOpenTutorModelRuntime({
    dataDir: dbPath === ':memory:' ? ':memory:' : undefined,
    authPath: dbPath === ':memory:' ? ':memory:' : undefined,
    modelsPath: dbPath === ':memory:' ? ':memory:' : undefined,
  });

  const providerService = new ProviderService(modelRuntime);
  const authService = new AuthService(modelRuntime);
  const modelSelectionService = new ModelSelectionService(modelRuntime, preferencesRepo);
  const sessionModelResolver = new SessionModelResolver(modelSelectionService, modelRuntime, agentSessionRepo);
  const roleModelResolver = new RoleModelResolver(modelSelectionService, modelRuntime, preferencesRepo);
  const isTestOrFake = process.env.OPENTUTOR_RUNTIME_MODE === 'fake' || process.env.NODE_ENV === 'test';
  const modelDriver = isTestOrFake ? new FakeModelDriver() : new PiModelDriver(modelRuntime);
  const modelExecutionService = new DefaultModelExecutionService(roleModelResolver, modelDriver);

  const knowledgeAnalyzer = isTestOrFake
    ? new FakeKnowledgeAnalyzer()
    : new ModelKnowledgeAnalyzer(modelExecutionService);

  const artifactSynthesizer = isTestOrFake
    ? new FakeArtifactSynthesizer()
    : new ModelArtifactSynthesizer(modelExecutionService);

  const goalAnalyzer = isTestOrFake
    ? new FakeGoalAnalyzer()
    : new ModelGoalAnalyzer(modelExecutionService);

  const lessonGenerator = isTestOrFake
    ? new FakeLessonGenerator()
    : new ModelLessonGenerator(modelExecutionService);

  const eventBus = new EventBus(eventRepo);
  const knowledgeCompiler = new LivingKnowledgeCompiler(db, knowledgeAnalyzer, artifactSynthesizer);
  const courseCompiler = new CourseCompiler(db, goalAnalyzer);
  const learningSessionCoordinator = new LearningSessionCoordinator(
    db,
    knowledgeCompiler.artifacts,
    lessonGenerator
  );

  const sessionService = new SessionService(sessionRepo, eventBus, learningSessionCoordinator);
  const lessonService = new LessonService(lessonRepo, eventBus);
  const searchService = new SearchService(db);
  const knowledgeService = new KnowledgeService(knowledgeRepo, searchService, eventBus, learningEvidenceRepo, undefined, db);
  const learningProgressService = new LearningProgressService(sessionService, eventBus);
  const assessmentService = new AssessmentService(lessonService, knowledgeService, learningProgressService);

  const diagnosticCoordinator = new DiagnosticLearningCoordinator({
    db,
    lessonService,
    sessionService,
    knowledgeService,
    assessmentService,
    progressService: learningProgressService,
    misconceptionRepo,
    diagnosisRepo,
    eventBus,
    probeGenerator: new ModelProbeGenerator(modelExecutionService),
  });
  const courseService = new CourseService(
    courseRepo,
    sessionRepo,
    lessonRepo,
    knowledgeCompiler,
    courseCompiler,
    lessonGenerator,
    eventBus
  );

  const toolsExecutor = new DomainToolsExecutor({
    lessonService,
    sessionService,
    knowledgeService,
    diagnosisRepository: diagnosisRepo,
    probeService: {
      requestProbe: async (sessionId, params) => {
        return diagnosticCoordinator.requestProbe({
          sessionId,
          prerequisiteNodeId: params.prerequisiteNodeId,
          reason: params.reason,
        });
      },
    },
  });

  const tutorRuntime =
    customRuntime ??
    new PiTutorRuntime(toolsExecutor, traceRepo, {
      modelRuntime,
      sessionModelResolver,
    });

  const context: RouteContext = {
    sessionService,
    lessonService,
    knowledgeService,
    assessmentService,
    learningProgressService,
    diagnosticCoordinator,
    courseService,
    providerService,
    authService,
    preferencesRepo,
    tutorRuntime,
    eventBus,
    traceRepo,
  };

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, context);
    } catch (err) {
      console.error('Unhandled request error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }));
    }
  });

  return {
    server,
    context,
    db,
    sessionRepo,
    lessonRepo,
    knowledgeRepo,
    evidenceRepo: learningEvidenceRepo,
    courseRepo,
    courseService,
    preferencesRepo,
    misconceptionRepo,
    diagnosisRepo,
    diagnosticCoordinator,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      db.close();
    },
  };
}

// Start server if run directly
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  createServerContext().then(({ server }) => {
    server.listen(PORT, HOST, () => {
      console.log(`OpenTutor server listening on http://${HOST}:${PORT}`);
    });
  });
}
