import { randomUUID } from 'node:crypto';
import type { Database, DiagnosisRepository, MisconceptionRepository } from '@opentutor/database';
import type {
  AssessmentResult,
  Lesson,
  QuizBlock,
  LearningPathNode,
  LearningDiagnosis,
} from '@opentutor/protocol';
import {
  ProbeService,
  ModelProbeGenerator,
  DiagnosisService,
  ReplanPolicy,
  MisconceptionUpdater,
} from '@opentutor/learning-core';
import type { LessonService } from './lesson-service.ts';
import type { SessionService } from './session-service.ts';
import type { KnowledgeService } from './knowledge-service.ts';
import type { AssessmentService } from './assessment-service.ts';
import type { LearningProgressService } from './learning-progress-service.ts';
import type { EventBus } from '../events/event-bus.ts';

export interface RequestProbeParams {
  sessionId: string;
  userId?: string;
  prerequisiteNodeId?: string;
  reason?: string;
}

export interface RequestProbeResult {
  success: boolean;
  probeBlockId?: string;
  targetKnowledgeNodeId?: string;
  message: string;
}

export interface SubmitAnswerCoordinatorInput {
  sessionId: string;
  userId?: string;
  lessonId: string;
  blockId: string;
  answer: string;
}

export interface SubmitAnswerCoordinatorResult {
  assessment: AssessmentResult;
  diagnosis?: LearningDiagnosis | null;
  replanAction?: 'continue' | 'insert_detour' | 'review';
  detourInserted?: boolean;
  detourResumed?: boolean;
}

export class DiagnosticLearningCoordinator {
  private readonly db: Database;
  private readonly lessonService: LessonService;
  private readonly sessionService: SessionService;
  private readonly knowledgeService: KnowledgeService;
  private readonly assessmentService: AssessmentService;
  private readonly progressService: LearningProgressService;
  private readonly misconceptionRepo?: MisconceptionRepository;
  private readonly diagnosisRepo?: DiagnosisRepository;
  private readonly eventBus: EventBus;
  private readonly probeService: ProbeService;
  private readonly probeGenerator: ModelProbeGenerator;
  private readonly diagnosisService: DiagnosisService;
  private readonly replanPolicy: ReplanPolicy;
  private readonly misconceptionUpdater: MisconceptionUpdater;

  constructor(options: {
    db: Database;
    lessonService: LessonService;
    sessionService: SessionService;
    knowledgeService: KnowledgeService;
    assessmentService: AssessmentService;
    progressService: LearningProgressService;
    misconceptionRepo?: MisconceptionRepository;
    diagnosisRepo?: DiagnosisRepository;
    eventBus: EventBus;
    probeService?: ProbeService;
    probeGenerator?: ModelProbeGenerator;
    diagnosisService?: DiagnosisService;
    replanPolicy?: ReplanPolicy;
    misconceptionUpdater?: MisconceptionUpdater;
  }) {
    this.db = options.db;
    this.lessonService = options.lessonService;
    this.sessionService = options.sessionService;
    this.knowledgeService = options.knowledgeService;
    this.assessmentService = options.assessmentService;
    this.progressService = options.progressService;
    this.misconceptionRepo = options.misconceptionRepo;
    this.diagnosisRepo = options.diagnosisRepo;
    this.eventBus = options.eventBus;

    this.probeService = options.probeService ?? new ProbeService();
    this.probeGenerator = options.probeGenerator ?? new ModelProbeGenerator();
    this.diagnosisService = options.diagnosisService ?? new DiagnosisService();
    this.replanPolicy = options.replanPolicy ?? new ReplanPolicy();
    this.misconceptionUpdater = options.misconceptionUpdater ?? new MisconceptionUpdater();
  }

  async requestProbe(params: RequestProbeParams): Promise<RequestProbeResult> {
    const snapshot = this.sessionService.getSnapshot(params.sessionId);
    if (!snapshot) {
      return { success: false, message: `Session ${params.sessionId} not found` };
    }

    const userId = params.userId ?? 'default-user';
    const activeLesson = snapshot.lesson;
    const targetNodeId = params.prerequisiteNodeId ?? 'softmax';

    // 1. Check prerequisite candidates / probe decision
    const probeDecision = this.probeService.decideProbe({
      activeNodeId: activeLesson.knowledgeNodeId,
      prerequisiteNodeIds: [targetNodeId],
      getKnowledgeState: (nodeId) => this.knowledgeService.getUserKnowledgeState(userId, nodeId),
      getMisconceptions: (nodeId) => this.misconceptionRepo?.getUserMisconceptions(userId) ?? [],
    });

    // 2. Generate structured diagnostic QuizBlock
    const probeBlock = await this.probeGenerator.generateProbe({
      targetKnowledgeNodeId: probeDecision.targetKnowledgeNodeId ?? targetNodeId,
      probeType: probeDecision.probeType ?? 'concept',
      candidateMisconceptionIds: probeDecision.candidateMisconceptionIds,
    });

    // 3. Patch the active lesson Canvas with the probe block
    const patchResult = this.lessonService.applyPatches(
      params.sessionId,
      activeLesson.id,
      activeLesson.version,
      [
        {
          op: 'insert',
          position: { index: activeLesson.blocks.length },
          block: probeBlock,
        },
      ]
    );

    return {
      success: true,
      probeBlockId: probeBlock.id,
      targetKnowledgeNodeId: probeBlock.targetKnowledgeNodeId,
      message: `Diagnostic probe for ${probeBlock.targetKnowledgeNodeId} placed on Lesson Canvas.`,
    };
  }

  async submitAnswer(input: SubmitAnswerCoordinatorInput): Promise<SubmitAnswerCoordinatorResult> {
    const snapshot = this.sessionService.getSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Session ${input.sessionId} not found`);
    }

    const userId = input.userId ?? 'default-user';
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

    // 1. Execute assessment evaluation and learning transaction
    const { assessment } = this.assessmentService.submitAnswer(input);

    let diagnosis: LearningDiagnosis | null = null;
    let replanAction: 'continue' | 'insert_detour' | 'review' = 'continue';
    let detourInserted = false;
    let detourResumed = false;

    // 2. If block is a probe or has candidate misconceptions, evaluate diagnosis
    const isProbe = block.assessmentKind === 'probe';
    if (isProbe) {
      diagnosis = this.diagnosisService.evaluateProbeResult({
        sessionId: input.sessionId,
        userId,
        probeBlock: block,
        assessmentResult: assessment,
      });

      if (diagnosis && this.diagnosisRepo) {
        this.diagnosisRepo.createDiagnosis(diagnosis);
        this.eventBus.publish(input.sessionId, 'diagnosis.updated', { diagnosis });
      }
    }

    // 3. Check for automatic replan / detour authorization
    const activeDiagnoses = this.diagnosisRepo?.listDiagnosesBySession(input.sessionId) ?? (diagnosis ? [diagnosis] : []);
    const replanDecision = this.replanPolicy.evaluateReplan({
      sessionId: input.sessionId,
      diagnoses: activeDiagnoses,
      currentPath: snapshot.path,
    });
    replanAction = replanDecision.action;

    if (replanDecision.action === 'insert_detour' && replanDecision.targetNodeId && replanDecision.diagnosisId) {
      const activePathNode = snapshot.path.find((n) => n.status === 'current');
      if (activePathNode && activePathNode.knowledgeNodeId !== replanDecision.targetNodeId) {
        const detourId = `detour-${replanDecision.targetNodeId}-${randomUUID().slice(0, 8)}`;
        const detourTitle = replanDecision.targetNodeId === 'softmax' ? 'Softmax Activation Function' : `Prerequisite: ${replanDecision.targetNodeId}`;

        await this.sessionService.insertDetour(
          input.sessionId,
          snapshot.pathVersion,
          {
            id: detourId,
            knowledgeNodeId: replanDecision.targetNodeId,
            title: detourTitle,
            note: replanDecision.reason,
          }
        );
        detourInserted = true;
      }
    }

    // 4. Check if current active detour is mastered and can be resumed
    const updatedSnapshot = this.sessionService.getSnapshot(input.sessionId);
    // 4. If target knowledge node is mastered, resolve any active confirmed diagnoses for it
    const targetState = this.knowledgeService.getUserKnowledgeState(userId, assessment.knowledgeNodeId);
    if (targetState && targetState.status === 'mastered' && this.diagnosisRepo) {
      const matchingDiagnoses = this.diagnosisRepo.listDiagnosesBySession(input.sessionId)
        .filter((d) => d.knowledgeNodeId === assessment.knowledgeNodeId && d.status === 'confirmed');
      for (const d of matchingDiagnoses) {
        this.diagnosisRepo.resolveDiagnosis(d.id);
      }
    }

    return {
      assessment,
      diagnosis,
      replanAction,
      detourInserted,
      detourResumed,
    };
  }
}
