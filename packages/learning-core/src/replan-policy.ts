import type { LearningDiagnosis, LearningPathNode } from '@opentutor/protocol';

export type ReplanAction = 'continue' | 'insert_detour' | 'review';

export interface ReplanDecision {
  action: ReplanAction;
  targetNodeId?: string;
  diagnosisId?: string;
  reason?: string;
}

export interface EvaluateReplanContext {
  sessionId: string;
  diagnoses: readonly LearningDiagnosis[];
  currentPath: readonly LearningPathNode[];
}

export interface ReplanEvaluationParams {
  diagnosis?: LearningDiagnosis | null;
  currentNodeId?: string;
  confidenceThreshold?: number;
}

export class ReplanPolicy {
  private readonly confidenceThreshold: number;

  constructor(options: { confidenceThreshold?: number } = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? 0.6;
  }

  evaluateReplan(context: EvaluateReplanContext): ReplanDecision {
    const { diagnoses, currentPath } = context;

    // Check for unresolved confirmed diagnoses
    for (const diagnosis of diagnoses) {
      if (diagnosis.status === 'confirmed') {
        const isCompleted = currentPath.some(
          (node) => node.knowledgeNodeId === diagnosis.knowledgeNodeId && node.status === 'completed'
        );

        if (!isCompleted) {
          return {
            action: 'insert_detour',
            targetNodeId: diagnosis.knowledgeNodeId,
            diagnosisId: diagnosis.id,
            reason: 'Confirmed prerequisite gap',
          };
        }
      }
    }

    return {
      action: 'continue',
    };
  }

  evaluate(params: ReplanEvaluationParams | LearningDiagnosis | null | undefined): ReplanDecision {
    let diagnosis: LearningDiagnosis | null | undefined;
    let currentNodeId: string | undefined;

    if (params && 'status' in params && 'knowledgeNodeId' in params) {
      diagnosis = params as LearningDiagnosis;
    } else if (params && typeof params === 'object') {
      const p = params as ReplanEvaluationParams;
      diagnosis = p.diagnosis;
      currentNodeId = p.currentNodeId;
    }

    if (!diagnosis) {
      return {
        action: 'continue',
        reason: 'No active diagnosis requiring path change',
      };
    }

    if (diagnosis.status === 'confirmed') {
      const confidence = typeof diagnosis.confidence === 'number' ? diagnosis.confidence : 1.0;
      if (confidence >= this.confidenceThreshold) {
        return {
          action: 'insert_detour',
          targetNodeId: diagnosis.knowledgeNodeId,
          diagnosisId: diagnosis.id,
          reason: `Confirmed diagnosis (${diagnosis.type}) for knowledge node ${diagnosis.knowledgeNodeId} authorizes detour`,
        };
      }
      return {
        action: 'review',
        targetNodeId: diagnosis.knowledgeNodeId,
        diagnosisId: diagnosis.id,
        reason: `Confirmed diagnosis for node ${diagnosis.knowledgeNodeId} has confidence ${confidence.toFixed(2)} below threshold ${this.confidenceThreshold.toFixed(2)}; recommend review instead of detour`,
      };
    }

    if (diagnosis.status === 'suspected') {
      return {
        action: 'continue',
        targetNodeId: diagnosis.knowledgeNodeId,
        diagnosisId: diagnosis.id,
        reason: `Diagnosis ${diagnosis.id} is only suspected; insert_detour is prohibited until confirmed`,
      };
    }

    return {
      action: 'continue',
      targetNodeId: currentNodeId,
      diagnosisId: diagnosis.id,
      reason: `Diagnosis ${diagnosis.id} is ${diagnosis.status}; proceed normally`,
    };
  }
}
