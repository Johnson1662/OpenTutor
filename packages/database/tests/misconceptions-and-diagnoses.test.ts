import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  seedDatabase,
  MisconceptionRepository,
  DiagnosisRepository,
  SessionFrameRepository,
  DEFAULT_SESSION_ID,
  DEFAULT_USER_ID,
} from '../src/index.ts';

describe('Misconceptions, Diagnoses, and Session Frames Repositories', () => {
  let db: Database.Database;
  let miscRepo: MisconceptionRepository;
  let diagRepo: DiagnosisRepository;
  let frameRepo: SessionFrameRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    miscRepo = new MisconceptionRepository(db);
    diagRepo = new DiagnosisRepository(db);
    frameRepo = new SessionFrameRepository(db);
  });

  describe('MisconceptionRepository', () => {
    it('creates, retrieves, and lists misconceptions', () => {
      const m1 = miscRepo.createMisconception({
        knowledgeNodeId: 'self-attention',
        title: 'Q-K confusion',
        description: 'Learner confuses Query and Key projections',
        correctionStrategy: 'Show probe on projection dimensions',
      });
      const m2 = miscRepo.createMisconception({
        knowledgeNodeId: 'self-attention',
        title: 'Softmax temperature neglect',
        description: 'Learner ignores scaling factor sqrt(d_k)',
      });

      assert.ok(m1.id);
      assert.ok(m2.id);

      const fetched = miscRepo.getMisconception(m1.id);
      assert.ok(fetched);
      assert.equal(fetched.title, 'Q-K confusion');
      assert.equal(fetched.correctionStrategy, 'Show probe on projection dimensions');

      const nodeMiscs = miscRepo.getMisconceptionsForNode('self-attention');
      assert.equal(nodeMiscs.length, 2);

      const allMiscs = miscRepo.listMisconceptions();
      assert.equal(allMiscs.length, 2);
    });

    it('manages user misconceptions lifecycle: set, get, increment evidence, and resolve', () => {
      const misc = miscRepo.createMisconception({
        knowledgeNodeId: 'softmax',
        title: 'Exponentiation overflow',
        description: 'Learner does not subtract max for numerical stability',
      });

      const initial = miscRepo.setUserMisconception({
        userId: DEFAULT_USER_ID,
        misconceptionId: misc.id,
        confidence: 0.5,
        status: 'suspected',
      });
      assert.equal(initial.status, 'suspected');
      assert.equal(initial.evidenceCount, 0);

      // Increment evidence count
      const incremented1 = miscRepo.incrementEvidenceCount(DEFAULT_USER_ID, misc.id, 0.6);
      assert.equal(incremented1.evidenceCount, 1);
      assert.equal(incremented1.status, 'suspected');

      const incremented2 = miscRepo.incrementEvidenceCount(DEFAULT_USER_ID, misc.id, 0.7);
      assert.equal(incremented2.evidenceCount, 2);

      // 3rd evidence count elevates to confirmed
      const incremented3 = miscRepo.incrementEvidenceCount(DEFAULT_USER_ID, misc.id, 0.75);
      assert.equal(incremented3.evidenceCount, 3);
      assert.equal(incremented3.status, 'confirmed');

      // Query with details
      const nodeUserMiscs = miscRepo.getUserMisconceptionsForNode(DEFAULT_USER_ID, 'softmax');
      assert.equal(nodeUserMiscs.length, 1);
      assert.equal(nodeUserMiscs[0].misconception.title, 'Exponentiation overflow');
      assert.equal(nodeUserMiscs[0].status, 'confirmed');

      // Filter by status
      const confirmedList = miscRepo.getUserMisconceptions(DEFAULT_USER_ID, 'confirmed');
      assert.equal(confirmedList.length, 1);

      const resolvedList = miscRepo.getUserMisconceptions(DEFAULT_USER_ID, 'resolved');
      assert.equal(resolvedList.length, 0);

      // Resolve misconception
      miscRepo.resolveUserMisconception(DEFAULT_USER_ID, misc.id);
      const resolved = miscRepo.getUserMisconception(DEFAULT_USER_ID, misc.id);
      assert.ok(resolved);
      assert.equal(resolved.status, 'resolved');
      assert.ok(resolved.resolvedAt);
    });
  });

  describe('DiagnosisRepository', () => {
    it('records and queries diagnoses by session, user, and node', () => {
      const d1 = diagRepo.recordDiagnosis({
        sessionId: DEFAULT_SESSION_ID,
        userId: DEFAULT_USER_ID,
        knowledgeNodeId: 'self-attention',
        type: 'misconception',
        confidence: 0.85,
        status: 'suspected',
        sourceEvidenceIds: ['ev-1', 'ev-2'],
      });

      const d2 = diagRepo.recordDiagnosis({
        sessionId: DEFAULT_SESSION_ID,
        userId: DEFAULT_USER_ID,
        knowledgeNodeId: 'softmax',
        type: 'missing_prerequisite',
        confidence: 0.9,
        status: 'confirmed',
        sourceEvidenceIds: ['ev-3'],
      });

      const fetched = diagRepo.getDiagnosis(d1.id);
      assert.ok(fetched);
      assert.equal(fetched.type, 'misconception');
      assert.deepEqual(fetched.sourceEvidenceIds, ['ev-1', 'ev-2']);

      const sessionDiags = diagRepo.getDiagnosesForSession(DEFAULT_SESSION_ID);
      assert.equal(sessionDiags.length, 2);

      const userDiags = diagRepo.getDiagnosesForUser(DEFAULT_USER_ID);
      assert.equal(userDiags.length, 2);

      const confirmedUserDiags = diagRepo.getDiagnosesForUser(DEFAULT_USER_ID, 'confirmed');
      assert.equal(confirmedUserDiags.length, 1);
      assert.equal(confirmedUserDiags[0].id, d2.id);

      const nodeDiags = diagRepo.getDiagnosesForNode(DEFAULT_USER_ID, 'self-attention');
      assert.equal(nodeDiags.length, 1);
      assert.equal(nodeDiags[0].id, d1.id);
    });

    it('updates diagnosis status and resolves diagnosis', () => {
      const diag = diagRepo.recordDiagnosis({
        sessionId: DEFAULT_SESSION_ID,
        userId: DEFAULT_USER_ID,
        knowledgeNodeId: 'self-attention',
        type: 'mastery_gap',
        confidence: 0.6,
        status: 'suspected',
      });

      diagRepo.updateDiagnosisStatus(diag.id, 'confirmed');
      const updated = diagRepo.getDiagnosis(diag.id);
      assert.ok(updated);
      assert.equal(updated.status, 'confirmed');

      diagRepo.resolveDiagnosis(diag.id);
      const resolved = diagRepo.getDiagnosis(diag.id);
      assert.ok(resolved);
      assert.equal(resolved.status, 'resolved');
      assert.ok(resolved.resolvedAt);
    });
  });

  describe('SessionFrameRepository', () => {
    it('pushes frames with depth and optional diagnosisId, peeks and pops active frame', () => {
      const diag = diagRepo.recordDiagnosis({
        sessionId: DEFAULT_SESSION_ID,
        userId: DEFAULT_USER_ID,
        knowledgeNodeId: 'self-attention',
        type: 'misconception',
      });

      const frame1 = frameRepo.pushFrame({
        sessionId: DEFAULT_SESSION_ID,
        detourPathNodeId: 'detour-softmax',
        parentPathNodeId: 'self-attention',
        savedLessonId: 'lesson-self-attention',
        diagnosisId: diag.id,
      });

      assert.equal(frame1.depth, 1);
      assert.equal(frame1.status, 'active');
      assert.equal(frame1.diagnosisId, diag.id);

      // Push nested frame (depth auto-increments to 2)
      const frame2 = frameRepo.pushFrame({
        sessionId: DEFAULT_SESSION_ID,
        detourPathNodeId: 'detour-exp',
        parentPathNodeId: 'detour-softmax',
        savedLessonId: 'lesson-softmax',
      });
      assert.equal(frame2.depth, 2);
      assert.equal(frame2.diagnosisId, null);

      // Peek active frame returns top of stack (depth 2)
      const active = frameRepo.peekActiveFrame(DEFAULT_SESSION_ID);
      assert.ok(active);
      assert.equal(active.id, frame2.id);
      assert.equal(active.depth, 2);

      // Pop active frame completes frame 2
      const popped1 = frameRepo.popActiveFrame(DEFAULT_SESSION_ID);
      assert.ok(popped1);
      assert.equal(popped1.id, frame2.id);
      assert.equal(popped1.status, 'completed');

      // Peek active frame now returns frame 1 (depth 1)
      const active2 = frameRepo.peekActiveFrame(DEFAULT_SESSION_ID);
      assert.ok(active2);
      assert.equal(active2.id, frame1.id);
      assert.equal(active2.depth, 1);
      assert.equal(active2.diagnosisId, diag.id);

      // Get all frames
      const allFrames = frameRepo.getFrames(DEFAULT_SESSION_ID);
      assert.equal(allFrames.length, 2);

      // Pop active frame completes frame 1
      const popped2 = frameRepo.popActiveFrame(DEFAULT_SESSION_ID);
      assert.ok(popped2);
      assert.equal(popped2.id, frame1.id);
      assert.equal(popped2.status, 'completed');

      // Peek active frame returns null when stack is empty
      const activeEmpty = frameRepo.peekActiveFrame(DEFAULT_SESSION_ID);
      assert.equal(activeEmpty, null);
    });
  });
});
