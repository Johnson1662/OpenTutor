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

    // 1. Resolve candidate prerequisites dynamically from knowledge graph
    let candidatePrereqs: string[] = [];
    if (params.prerequisiteNodeId) {
      candidatePrereqs = [params.prerequisiteNodeId];
    } else {
      const rows = this.db
        .prepare("SELECT from_node_id FROM knowledge_edges WHERE to_node_id = ? AND relation_type = 'prerequisite' ORDER BY created_at ASC")
        .all(activeLesson.knowledgeNodeId) as Array<{ from_node_id: string }>;
      candidatePrereqs = rows.map((r) => r.from_node_id);
      if (candidatePrereqs.length === 0) {
        return {
          success: false,
          message: 'PROBE_TARGET_NOT_FOUND: No prerequisite found for probing',
        };
      }
    }
    // 2. Check prerequisite candidates / probe decision
    const probeDecision = this.probeService.decideProbe({
      activeNodeId: activeLesson.knowledgeNodeId,
      prerequisiteNodeIds: candidatePrereqs,
      getKnowledgeState: (nodeId) => this.knowledgeService.getUserKnowledgeState(userId, nodeId),
      getMisconceptions: (nodeId) => this.misconceptionRepo?.getUserMisconceptionsForNode(userId, nodeId) ?? [],
    });

    if (!probeDecision.shouldProbe || !probeDecision.targetKnowledgeNodeId) {
      return {
        success: true,
        message: 'PROBE_NOT_REQUIRED',
      };
    }

    const targetNodeId = probeDecision.targetKnowledgeNodeId;
    let nodeTitle: string | undefined;
    let nodeDescription: string | undefined;
    try {
      const nodeRow = this.db
        .prepare('SELECT title, description FROM knowledge_nodes WHERE id = ?')
        .get(targetNodeId) as { title: string; description: string } | undefined;
      nodeTitle = nodeRow?.title;
      nodeDescription = nodeRow?.description;
    } catch {}

    // 3. Generate structured diagnostic QuizBlock grounded in Living Knowledge
    const probeBlock = await this.probeGenerator.generateProbe({
      targetKnowledgeNodeId: targetNodeId,
      probeType: probeDecision.probeType ?? 'concept',
      candidateMisconceptionIds: probeDecision.candidateMisconceptionIds,
      nodeTitle,
      nodeDescription,
    });

    // 4. Patch the active lesson Canvas with the probe block
    this.lessonService.applyPatches(
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
    this.progressService.activateBlock(params.sessionId, activeLesson.id, probeBlock.id);

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
    if (snapshot.lesson.id !== input.lessonId) {
      throw new Error(`LESSON_NOT_ACTIVE: ${input.lessonId}`);
    }
    if (snapshot.lessonProgress && snapshot.lessonProgress.activeBlockId !== input.blockId) {
      throw new Error(`BLOCK_NOT_ACTIVE: ${input.blockId}`);
    }

    // 1. Execute assessment evaluation and learning transaction (Single Authority)
    const result = this.assessmentService.submitAnswer(input);
    const assessment = result.assessment;
    const diagnosis = result.diagnosis ?? null;

    let replanAction: 'continue' | 'insert_detour' | 'review' = 'continue';
    let detourInserted = false;
    let detourResumed = false;

    // 2. Check for automatic replan / detour authorization
    const activeDiagnoses = this.diagnosisRepo?.listDiagnosesBySession(input.sessionId) ?? (diagnosis ? [diagnosis] : []);
    const replanDecision = this.replanPolicy.evaluateReplan({
      sessionId: input.sessionId,
      diagnoses: activeDiagnoses,
      currentPath: snapshot.path,
    });
    replanAction = replanDecision.action;

    if (replanDecision.action === 'insert_detour' && replanDecision.targetNodeId && replanDecision.diagnosisId) {
      const isProbe = ('assessmentKind' in block && block.assessmentKind === 'probe') || input.blockId.startsWith('probe-');
      if (isProbe && assessment.result === 'incorrect' && snapshot.lessonProgress) {
        const resumeBlockId = lesson.blocks.find(
          (candidate) =>
            candidate.id !== input.blockId && !snapshot.lessonProgress!.completedBlockIds.includes(candidate.id)
        )?.id;
        if (resumeBlockId) {
          this.progressService.activateBlock(input.sessionId, lesson.id, resumeBlockId);
          this.lessonService.applyPatches(input.sessionId, lesson.id, lesson.version, [
            { op: 'remove', blockId: input.blockId },
          ]);
        }
      }
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
          },
          {
            diagnosisId: replanDecision.diagnosisId,
          }
        );
        detourInserted = true;
      }
    }
    // If the target is mastered, resolve any active confirmed diagnoses for it
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
