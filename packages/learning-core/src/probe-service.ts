import type {
  UserKnowledgeState,
  UserMisconception,
} from '@opentutor/protocol';

export interface ProbeDecision {
  shouldProbe: boolean;
  targetKnowledgeNodeId?: string;
  reason?: string;
  probeType?: 'recall' | 'concept' | 'application' | 'misconception';
  candidateMisconceptionIds?: string[];
}

export interface ProbeDecideContext {
  activeNodeId?: string;
  prerequisiteNodeIds: readonly string[];
  getKnowledgeState: (nodeId: string) => UserKnowledgeState | null;
  getMisconceptions?: (nodeId: string) => readonly UserMisconception[];
}

export interface DecideProbeParams {
  targetKnowledgeNodeId: string;
  prerequisiteState?: UserKnowledgeState | null;
  userMisconceptions?: readonly UserMisconception[];
  candidateMisconceptionIds?: readonly string[];
}

export interface EvaluatePrerequisitesParams {
  targetNodeId: string;
  prerequisiteNodeIds: readonly string[];
  userStates: ReadonlyMap<string, UserKnowledgeState> | Readonly<Record<string, UserKnowledgeState>>;
  userMisconceptionsByNodeId?: ReadonlyMap<string, readonly UserMisconception[]> | Readonly<Record<string, readonly UserMisconception[]>>;
}

export class ProbeService {
  decideProbe(params: DecideProbeParams | ProbeDecideContext): ProbeDecision {
    if ('prerequisiteNodeIds' in params) {
      const context = params as ProbeDecideContext;
      const { prerequisiteNodeIds, getKnowledgeState, getMisconceptions } = context;

      if (!prerequisiteNodeIds || prerequisiteNodeIds.length === 0) {
        return {
          shouldProbe: false,
          targetKnowledgeNodeId: context.activeNodeId,
          reason: 'No prerequisites to probe',
        };
      }

      for (const pNodeId of prerequisiteNodeIds) {
        const pState = getKnowledgeState(pNodeId);
        const pMisconceptions = getMisconceptions ? getMisconceptions(pNodeId) : [];

        const decision = this.decideSinglePrerequisiteProbe({
          targetKnowledgeNodeId: pNodeId,
          prerequisiteState: pState,
          userMisconceptions: pMisconceptions,
        });

        if (decision.shouldProbe) {
          return decision;
        }
      }

      return {
        shouldProbe: false,
        targetKnowledgeNodeId: context.activeNodeId,
        reason: `All ${prerequisiteNodeIds.length} prerequisites are mastered`,
      };
    }

    return this.decideSinglePrerequisiteProbe(params as DecideProbeParams);
  }

  private decideSinglePrerequisiteProbe(params: DecideProbeParams): ProbeDecision {
    const { targetKnowledgeNodeId, prerequisiteState, userMisconceptions, candidateMisconceptionIds } = params;

    // Check for suspected misconceptions on the prerequisite
    const suspected = (userMisconceptions ?? []).filter((m) => m.status === 'suspected');
    if (suspected.length > 0) {
      const misconceptionIds = candidateMisconceptionIds?.length
        ? Array.from(candidateMisconceptionIds)
        : suspected.map((m) => m.misconceptionId);

      return {
        shouldProbe: true,
        targetKnowledgeNodeId,
        reason: `Suspected misconception (${suspected.map((m) => m.misconceptionId).join(', ')}) detected on prerequisite`,
        probeType: 'misconception',
        candidateMisconceptionIds: misconceptionIds,
      };
    }

    // Prerequisite state unknown or no state recorded
    if (!prerequisiteState || prerequisiteState.status === 'unknown' || (prerequisiteState.evidenceCount ?? 0) === 0) {
      return {
        shouldProbe: true,
        targetKnowledgeNodeId,
        reason: 'Prerequisite knowledge state is unknown',
        probeType: 'recall',
        candidateMisconceptionIds: candidateMisconceptionIds?.length ? Array.from(candidateMisconceptionIds) : undefined,
      };
    }

    const p = prerequisiteState.masteryProbability ?? prerequisiteState.confidence ?? 0.5;
    const effectiveEvidence = prerequisiteState.effectiveEvidenceCount ?? prerequisiteState.evidenceCount ?? 0;
    const distinctItems = prerequisiteState.distinctSourceItemCount ?? 0;

    // Prerequisite mastered condition
    const isMastered =
      prerequisiteState.status === 'mastered' ||
      (p >= 0.85 && effectiveEvidence >= 3.0 && (distinctItems >= 2 || (prerequisiteState.evidenceCount ?? 0) >= 3));

    if (isMastered) {
      return {
        shouldProbe: false,
        targetKnowledgeNodeId,
        reason: `Prerequisite is mastered (p=${p.toFixed(2)}, evidence=${effectiveEvidence.toFixed(1)})`,
      };
    }

    // Uncertain or weak mastery (p < 0.40 or weak status)
    if (p < 0.40 || prerequisiteState.status === 'weak') {
      return {
        shouldProbe: true,
        targetKnowledgeNodeId,
        reason: `Prerequisite mastery is weak (p=${p.toFixed(2)})`,
        probeType: 'concept',
        candidateMisconceptionIds: candidateMisconceptionIds?.length ? Array.from(candidateMisconceptionIds) : undefined,
      };
    }

    // Uncertain mastery (0.30 <= p <= 0.70)
    if (p >= 0.30 && p <= 0.70) {
      return {
        shouldProbe: true,
        targetKnowledgeNodeId,
        reason: `Prerequisite mastery is uncertain (p=${p.toFixed(2)})`,
        probeType: 'concept',
        candidateMisconceptionIds: candidateMisconceptionIds?.length ? Array.from(candidateMisconceptionIds) : undefined,
      };
    }

    // Learning in progress (0.70 < p < 0.85)
    return {
      shouldProbe: true,
      targetKnowledgeNodeId,
      reason: `Prerequisite is in learning state (p=${p.toFixed(2)}, effective evidence=${effectiveEvidence.toFixed(1)})`,
      probeType: 'application',
      candidateMisconceptionIds: candidateMisconceptionIds?.length ? Array.from(candidateMisconceptionIds) : undefined,
    };
  }

  evaluatePrerequisites(params: EvaluatePrerequisitesParams): ProbeDecision {
    const { targetNodeId, prerequisiteNodeIds, userStates, userMisconceptionsByNodeId } = params;

    const getState = (id: string): UserKnowledgeState | null => {
      if (userStates instanceof Map) {
        return userStates.get(id) ?? null;
      }
      return (userStates as Record<string, UserKnowledgeState>)[id] ?? null;
    };

    const getMisconceptions = (id: string): readonly UserMisconception[] => {
      if (!userMisconceptionsByNodeId) return [];
      if (userMisconceptionsByNodeId instanceof Map) {
        return userMisconceptionsByNodeId.get(id) ?? [];
      }
      return (userMisconceptionsByNodeId as Record<string, readonly UserMisconception[]>)[id] ?? [];
    };

    return this.decideProbe({
      activeNodeId: targetNodeId,
      prerequisiteNodeIds,
      getKnowledgeState: getState,
      getMisconceptions,
    });
  }
}
