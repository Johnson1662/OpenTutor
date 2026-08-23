import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, CourseRepository } from '@opentutor/database';
import {
  LivingKnowledgeCompiler,
  CourseSourceService,
  computeSha256,
} from '../src/index.ts';

test('packages/knowledge-core - CourseSourceService & Ref-Counted Deletion', async (t) => {
  const db = createDatabase(':memory:');
  const courseRepo = new CourseRepository(db);
  const livingCompiler = new LivingKnowledgeCompiler(db);
  const sourceService = new CourseSourceService(
    courseRepo,
    livingCompiler.ingestion,
    livingCompiler.lifecycle
  );

  courseRepo.createCourse({ id: 'course-a', title: 'Course A' });
  courseRepo.createCourse({ id: 'course-b', title: 'Course B' });

  const content = `# Attention Mechanism\n\nSelf-attention connects all positions in a sequence.`;
  const expectedHash = computeSha256(content);

  let docId = '';

  await t.test('1. Single upload produces exactly 1 active version with SHA-256 hash', () => {
    const src = sourceService.addSource('course-a', 'Attention Guide', content);
    docId = src.documentId;

    assert.ok(docId.startsWith('doc-'));
    assert.equal(src.version, 1);
    assert.equal(src.status, 'active');

    const versions = db
      .prepare('SELECT id, version, content_hash, status FROM document_versions WHERE document_id = ?')
      .all(docId) as Array<{ id: string; version: number; content_hash: string; status: string }>;

    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.version, 1);
    assert.equal(versions[0]?.content_hash, expectedHash);
    assert.equal(versions[0]?.status, 'active');

    const sources = sourceService.listSources('course-a');
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.documentId, docId);
  });

  await t.test('2. Compiling does not produce a phantom duplicate version', async () => {
    const compileResult = await livingCompiler.ingestAndCompile({
      id: docId,
      title: 'Attention Guide',
      content,
    });

    assert.equal(compileResult.document.isNewVersion, false);
    assert.equal(compileResult.document.isDuplicate, true);
    assert.equal(compileResult.document.version, 1);
    assert.equal(compileResult.document.contentHash, expectedHash);

    const versions = db
      .prepare('SELECT id, version, content_hash, status FROM document_versions WHERE document_id = ?')
      .all(docId) as Array<{ id: string; version: number; content_hash: string; status: string }>;

    assert.equal(versions.length, 1, 'Should strictly have 1 version after compilation');
    assert.equal(versions[0]?.version, 1);
    assert.equal(versions[0]?.status, 'active');
  });

  await t.test('3. Deleting one link of a shared source does NOT delete the document or deactivate evidence', () => {
    // Share the same document with course-b
    courseRepo.attachCourseSource('course-b', docId);

    assert.equal(courseRepo.countCourseSourceReferences(docId), 2);
    assert.equal(sourceService.listSources('course-a').length, 1);
    assert.equal(sourceService.listSources('course-b').length, 1);

    // Create knowledge node if needed
    const node = livingCompiler.resolver.resolve('Self Attention');

    // Verify claim evidence is active
    const chunks = db
      .prepare('SELECT id FROM document_chunks WHERE document_version_id = (SELECT id FROM document_versions WHERE document_id = ?)')
      .all(docId) as Array<{ id: string }>;
    assert.ok(chunks.length > 0);

    const chunkId = chunks[0]!.id;
    const claim = livingCompiler.claims.recordClaim(node.id, 'Self-attention connects all positions.');
    livingCompiler.evidence.linkEvidence(claim.id, chunkId, 'supports', 1.0, true);

    const evidenceBefore = livingCompiler.evidence.getEvidenceForClaim(claim.id, true);
    assert.equal(evidenceBefore.length, 1);
    assert.equal(evidenceBefore[0]?.isActive, true);

    // Detach from course-a
    const deleteRes = sourceService.deleteSource('course-a', docId);
    assert.equal(deleteRes.detached, true);
    assert.equal(deleteRes.deletedDocument, false);

    // References remain 1 (for course-b)
    assert.equal(courseRepo.countCourseSourceReferences(docId), 1);
    assert.equal(sourceService.listSources('course-a').length, 0);
    assert.equal(sourceService.listSources('course-b').length, 1);

    // Document version remains active
    const versionRow = db
      .prepare('SELECT status FROM document_versions WHERE document_id = ?')
      .get(docId) as { status: string };
    assert.equal(versionRow.status, 'active');

    // Claim evidence remains active
    const evidenceAfter = livingCompiler.evidence.getEvidenceForClaim(claim.id, true);
    assert.equal(evidenceAfter.length, 1);
    assert.equal(evidenceAfter[0]?.isActive, true);
    assert.equal(livingCompiler.claims.getClaimById(claim.id)?.status, 'supported');
  });

  await t.test('4. Deleting the final course source deactivates evidence and marks document deleted', () => {
    // Detach from course-b (final reference)
    const deleteRes = sourceService.deleteSource('course-b', docId);
    assert.equal(deleteRes.detached, true);
    assert.equal(deleteRes.deletedDocument, true);

    // References is now 0
    assert.equal(courseRepo.countCourseSourceReferences(docId), 0);
    assert.equal(sourceService.listSources('course-b').length, 0);

    // Document version is marked deleted
    const versionRow = db
      .prepare('SELECT status FROM document_versions WHERE document_id = ?')
      .get(docId) as { status: string };
    assert.equal(versionRow.status, 'deleted');

    // Claim evidence is deactivated (is_active = 0)
    const evidenceRows = db
      .prepare('SELECT is_active FROM claim_evidence WHERE document_chunk_id IN (SELECT id FROM document_chunks WHERE document_version_id IN (SELECT id FROM document_versions WHERE document_id = ?))')
      .all(docId) as Array<{ is_active: number }>;

    assert.ok(evidenceRows.length > 0);
    for (const row of evidenceRows) {
      assert.equal(row.is_active, 0);
    }

    // Active evidence query returns empty
    const node = livingCompiler.resolver.resolve('Self Attention');
    const claim = livingCompiler.claims.getClaimsForNode(node.id)[0];
    assert.ok(claim);
    const activeEvidence = livingCompiler.evidence.getEvidenceForClaim(claim.id, true);
    assert.equal(activeEvidence.length, 0);
    assert.equal(livingCompiler.claims.getClaimById(claim.id)?.status, 'deprecated');
  });

  await t.test('5. Zero Deleted Knowledge Retrieval: sourceSearch, sourceRead, knowledgeSearch, artifactRead completely hide deleted knowledge', () => {
    const searchService = livingCompiler.retrieval;

    // 1. sourceSearch on deleted content returns 0 results
    const sourceSearchResults = searchService.sourceSearch('Self-attention connects all positions');
    assert.equal(sourceSearchResults.length, 0, 'Deleted source chunks must not appear in sourceSearch');

    // 2. sourceRead on deleted chunk returns null
    const chunks = db
      .prepare('SELECT id FROM document_chunks WHERE document_version_id IN (SELECT id FROM document_versions WHERE document_id = ?)')
      .all(docId) as Array<{ id: string }>;
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      const readRes = searchService.sourceRead(chunk.id);
      assert.equal(readRes, null, 'Deleted chunk must return null on sourceRead');
    }

    // 3. knowledgeSearch for deleted node with all deprecated claims returns 0 results
    const node = livingCompiler.resolver.resolve('Self Attention');
    const knowledgeResults = searchService.knowledgeSearch('Self Attention');
    const foundDeletedNode = knowledgeResults.find((r) => r.nodeId === node.id);
    assert.equal(foundDeletedNode, undefined, 'Knowledge node with only deprecated claims and 0 evidence must not be returned');

    // 4. artifactRead for deleted knowledge returns null
    const artifact = searchService.artifactRead(node.id);
    assert.equal(artifact, null, 'Artifact for deleted knowledge must return null');
  });
});
