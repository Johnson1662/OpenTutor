import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { createDatabase, seedDatabase } from '@opentutor/database';
import {
 DefaultModelExecutionService,
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
 EntityResolver,
} from '@opentutor/knowledge-core';
import {
 LessonValidator,
} from '@opentutor/lesson-core';
import {
 PrerequisiteResolver,
} from '@opentutor/course-core';

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

  const brokenService = new DefaultModelExecutionService(mockRoleResolver, async () => {
   return '<html>Internal Server Error 502</html>';
  });

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
});
