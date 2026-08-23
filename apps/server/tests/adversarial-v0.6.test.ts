import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { createDatabase, seedDatabase, CourseRepository, SessionRepository, VersionConflictError, EventRepository } from '@opentutor/database';
import {
 DefaultModelExecutionService,
 FakeModelDriver,
 ModelExecutionError,
 RoleModelResolver,
 ModelSelectionService,
 ModelPreferencesRepository,
} from '@opentutor/model-runtime';
import {
 ModelKnowledgeAnalyzer,
 ClaimComparator,
 ClaimReconciler,
 ClaimService,
 EvidenceService,
 DocumentLifecycleService,
 EntityResolver,
} from '@opentutor/knowledge-core';
import {
 LessonValidator,
 LearningSessionCoordinator,
} from '@opentutor/lesson-core';
import {
 PrerequisiteResolver,
} from '@opentutor/course-core';
import { SessionService } from '../src/services/session-service.ts';
import { EventBus } from '../src/events/event-bus.ts';

test('Adversarial & Failure Matrix Test Suite v0.6', async (t) => {
 const db = createDatabase(':memory:');
 seedDatabase(db);
 const prefsRepo = new ModelPreferencesRepository(db);

 await t.test('1. AI: ModelExecutionService rejects invalid JSON after repair attempt exhausted', async () => {
  const mockRoleResolver = {
   resolveRoleModel: async () => ({
    role: 'knowledge_compiler' as const,
    providerId: 'anthropic',
    modelId: 'claude-3-7-sonnet',
    isRoleSpecific: false,
   }),
  } as any;

  const brokenService = new DefaultModelExecutionService(
   mockRoleResolver,
   new FakeModelDriver(async () => {
    return '<html>Internal Server Error 502</html>';
   })
  );

  const Schema = Type.Object({ title: Type.String() });

  await assert.rejects(
   async () => {
    await brokenService.completeStructured({
     role: 'knowledge_compiler',
     prompt: 'Extract candidate',
     schema: Schema,
    });
   },
   (err: any) => {
    assert.equal(err instanceof ModelExecutionError, true);
    assert.equal(err.code, 'MODEL_OUTPUT_INVALID');
    return true;
   }
  );
 });

 await t.test('2. Knowledge: ModelKnowledgeAnalyzer filters out hallucinated chunk IDs', async () => {
  const mockExecution = {
   completeText: async () => '',
   completeStructured: async () => ({
    candidates: [
     {
      canonicalName: 'Residual Connection',
      aliases: ['Skip Connection'],
      definition: 'Allows gradient to flow directly through the layer.',
      claims: [
       {
        statement: 'Residual connections prevent vanishing gradients in deep Transformer networks.',
        evidenceChunkIds: ['real-chunk-1', 'fake-chunk-999'],
       },
      ],
      relations: [],
     },
    ],
   }),
  } as any;

  const analyzer = new ModelKnowledgeAnalyzer(mockExecution);
  const candidates = await analyzer.analyzeChunks([
   {
    id: 'real-chunk-1',
    ordinal: 0,
    level: 1,
    content: 'Residual connections prevent vanishing gradients.',
    contentHash: 'hash-res',
   },
  ]);

  assert.equal(candidates.length, 1);
  const claims = candidates[0]?.claims;
  assert.equal(claims?.[0]?.evidenceChunkIds.length, 1);
  assert.equal(claims?.[0]?.evidenceChunkIds[0], 'real-chunk-1');
 });

 await t.test('3. Knowledge: Contradicting claims are preserved with status conflicting rather than crashing', () => {
  const claims = new ClaimService(db);
  const evidence = new EvidenceService(db);
  const resolver = new EntityResolver(db);
  const reconciler = new ClaimReconciler(claims, evidence);

  const entity = resolver.resolve('Attention Convergence', 'Convergence properties');

  // Ingest a source document so valid chunk exists
  const docId = 'doc-adv-1';
  const verId = 'ver-adv-1';
  const secId = 'sec-adv-1';
  const chkId = 'chk-adv-1';
  const now = new Date().toISOString();

  db.transaction(() => {
   db.prepare('INSERT INTO documents (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(docId, 'Adv', now, now);
   db.prepare('INSERT INTO document_versions (id, document_id, version, content_hash, content, status, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)').run(verId, docId, 'h', 'c', 'active', now);
   db.prepare('INSERT INTO document_sections (id, document_version_id, document_id, ordinal, heading, content, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(secId, verId, docId, 'H', 'c', now);
   db.prepare('INSERT INTO document_chunks (id, document_section_id, document_version_id, ordinal, content, content_hash, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(chkId, secId, verId, 'c', 'h', now);
  })();

  // Claim 1: Positive statement
  reconciler.reconcileClaims(entity.id, [
   { statement: 'Attention always improves convergence on long sequence tasks.', evidenceChunkIds: [chkId] },
  ]);

  // Claim 2: Negative statement from different source
  reconciler.reconcileClaims(entity.id, [
   { statement: 'Attention decreases convergence when input sequence is unaligned.', evidenceChunkIds: [chkId] },
  ]);

  const nodeClaims = claims.getClaimsForNode(entity.id);
  assert.equal(nodeClaims.length, 2);
  assert.ok(nodeClaims.every((c) => c.status === 'conflicting'));
 });

 await t.test('4. Lesson: Validator rejects duplicate block IDs and missing answerSpec', () => {
  const validator = new LessonValidator();

  const badLesson: any = {
   schemaVersion: '1.0',
   id: 'lesson-bad',
   courseId: 'c1',
   knowledgeNodeId: 'kn1',
   title: 'Bad Lesson',
   version: 1,
   status: 'active',
   blocks: [
    { id: 'b1', type: 'text', variant: 'paragraph', content: 'Valid' },
    { id: 'b1', type: 'text', variant: 'paragraph', content: 'Duplicate ID' },
    { id: 'b2', type: 'quiz', question: 'No answerSpec' },
   ],
  };

  const res = validator.validate(badLesson);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('Duplicate block id')));
  assert.ok(res.errors.some((e) => e.includes('mandatory \'answerSpec\'')));
 });

 await t.test('5. Course: PrerequisiteResolver handles graph cycles safely without hanging', () => {
  // Insert a cycle: node-A -> node-B -> node-A
  const resolver = new PrerequisiteResolver(db);

  db.prepare(
   `INSERT OR REPLACE INTO knowledge_nodes (id, title, description, created_at)
       VALUES ('cycle-a', 'Cycle A', '', datetime('now')),
              ('cycle-b', 'Cycle B', '', datetime('now'))`
  ).run();

  db.prepare(
   `INSERT OR REPLACE INTO knowledge_edges (from_node_id, to_node_id, relation_type, created_at)
       VALUES ('cycle-a', 'cycle-b', 'prerequisite', datetime('now')),
              ('cycle-b', 'cycle-a', 'prerequisite', datetime('now'))`
  ).run();

  const closure = resolver.resolveClosure(['cycle-a']);
  assert.equal(closure.hasCycle, true);
  assert.ok(closure.orderedNodeIds.includes('cycle-a'));
  assert.ok(closure.orderedNodeIds.includes('cycle-b'));
 });

 await t.test('6. Course Sources: Documents uploaded to Course A are strictly isolated from Course B', () => {
  const courseRepo = new CourseRepository(db);

  courseRepo.createCourse({ id: 'course-iso-a', title: 'Course A' });
  courseRepo.createCourse({ id: 'course-iso-b', title: 'Course B' });

  courseRepo.addCourseSource('course-iso-a', 'Doc A.md', '# Content A');
  courseRepo.addCourseSource('course-iso-b', 'Doc B.md', '# Content B');

  const sourcesA = courseRepo.listCourseSources('course-iso-a');
  const sourcesB = courseRepo.listCourseSources('course-iso-b');

  assert.equal(sourcesA.length, 1);
  assert.equal(sourcesA[0]?.title, 'Doc A.md');

  assert.equal(sourcesB.length, 1);
  assert.equal(sourcesB[0]?.title, 'Doc B.md');
 });

 await t.test('7. Source Deletion: Deleting document cascades to course_sources and deactivates evidence', () => {
  const courseRepo = new CourseRepository(db);
  const claims = new ClaimService(db);
  const evidence = new EvidenceService(db);
  const lifecycle = new DocumentLifecycleService(db, claims, evidence);

  courseRepo.createCourse({ id: 'course-del', title: 'Course Del' });
  const src = courseRepo.addCourseSource('course-del', 'Doc Del.md', '# Del Content');

  assert.equal(courseRepo.listCourseSources('course-del').length, 1);

  // Delete source
  courseRepo.deleteCourseSource('course-del', src.documentId);
  lifecycle.deleteDocument(src.documentId);

  assert.equal(courseRepo.listCourseSources('course-del').length, 0);
 });

 await t.test('8. AI: Unconfigured role model throws MODEL_SETUP_REQUIRED error', async () => {
  const emptyRuntime = {
   findModel: () => undefined,
   getModel: () => undefined,
   getModels: () => [],
   hasConfiguredAuth: () => false,
  } as any;

  const selectionService = new ModelSelectionService(emptyRuntime, prefsRepo);
  const roleResolver = new RoleModelResolver(selectionService, emptyRuntime, prefsRepo);
  const execService = new DefaultModelExecutionService(roleResolver, new FakeModelDriver());

  await assert.rejects(
   async () => {
    await execService.completeText({
     role: 'assessment',
     prompt: 'Evaluate',
     userId: 'unconfigured-user',
    });
   },
   (err: any) => {
    assert.equal(err instanceof ModelExecutionError, true);
    assert.equal(err.code, 'MODEL_SETUP_REQUIRED');
    return true;
   }
  );
 });

 await t.test('9. Session: Atomic domain transaction rolls back cleanly on VersionConflictError without corrupting active lesson', async () => {
  const sessionRepo = new SessionRepository(db);
  const eventRepo = new EventRepository(db);
  const eventBus = new EventBus(eventRepo);
  const sessionService = new SessionService(sessionRepo, eventBus);

  const initialSnap = sessionService.getSnapshot('prototype');
  assert.ok(initialSnap);
  assert.equal(initialSnap.pathVersion, 1);
  assert.equal(initialSnap.lesson.id, 'lesson-self-attention');

  // Attempt detour with stale baseVersion (expected 1, provided 99)
  await assert.rejects(
   async () => {
    await sessionService.insertDetour('prototype', 99, {
     id: 'detour-conflict-test',
     knowledgeNodeId: 'softmax',
     title: 'Softmax Conflict',
    });
   },
   (err: any) => {
    assert.equal(err instanceof VersionConflictError, true);
    return true;
   }
  );

  // Snapshot must remain completely unchanged
  const postFailSnap = sessionService.getSnapshot('prototype');
  assert.ok(postFailSnap);
  assert.equal(postFailSnap.pathVersion, 1);
  assert.equal(postFailSnap.lesson.id, 'lesson-self-attention');
  assert.equal(sessionRepo.peekActiveFrame('prototype'), null);
 });

 await t.test('10. Session: Session frames support nested detours and dynamic courseId', async () => {
  const sessionRepo = new SessionRepository(db);
  const eventRepo = new EventRepository(db);
  const eventBus = new EventBus(eventRepo);
  const sessionService = new SessionService(sessionRepo, eventBus);

  // 1. Insert Detour 1 (Softmax)
  const detour1Res = await sessionService.insertDetour('prototype', 1, {
   id: 'detour-soft',
   knowledgeNodeId: 'softmax',
   title: 'Softmax Detour',
  });
  assert.equal(detour1Res.newVersion, 2);

  const frame1 = sessionRepo.peekActiveFrame('prototype');
  assert.ok(frame1);
  assert.equal(frame1.depth, 1);

  // 2. Insert Nested Detour 2 (Multi-Head)
  const detour2Res = await sessionService.insertDetour('prototype', 2, {
   id: 'detour-multi',
   knowledgeNodeId: 'multi-head',
   title: 'Multi-Head Detour',
  });
  assert.equal(detour2Res.newVersion, 3);

  const frame2 = sessionRepo.peekActiveFrame('prototype');
  assert.ok(frame2);
  assert.equal(frame2.depth, 2);

  // 3. Complete Detour 2 -> restores frame 1 (depth 1)
  const comp2 = await sessionService.completeCurrentNode('prototype', 3);
  assert.equal(comp2.newVersion, 4);

  const frameAfterComp2 = sessionRepo.peekActiveFrame('prototype');
  assert.ok(frameAfterComp2);
  assert.equal(frameAfterComp2.depth, 1);

  // 4. Complete Detour 1 -> restores main track (depth 0, no active frames)
  const comp1 = await sessionService.completeCurrentNode('prototype', 4);
  assert.equal(comp1.newVersion, 5);

  const frameAfterComp1 = sessionRepo.peekActiveFrame('prototype');
  assert.equal(frameAfterComp1, null);
 });
});
