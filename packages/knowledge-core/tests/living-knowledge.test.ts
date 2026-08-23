import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '@opentutor/database';
import {
  LivingKnowledgeCompiler,
  EntityResolver,
  ClaimService,
  EvidenceService,
  RetrievalTracker,
  RetrievalBudgetLevel,
  parseMarkdown,
  computeSha256,
} from '../src/index.ts';

test('packages/knowledge-core - Living Knowledge Compiler & Agentic Retrieval', async (t) => {
  const db = createDatabase(':memory:');
  const livingCompiler = new LivingKnowledgeCompiler(db);

  await t.test('1. Markdown parser and SHA-256 deduplication', () => {
    const raw = `# Background\n\nAttention mechanisms compute representations.\n\n# Softmax\n\nSoftmax converts logits into probabilities.`;
    const chunks = parseMarkdown(raw);

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.heading, 'Background');
    assert.equal(chunks[1]?.heading, 'Softmax');
    assert.ok(chunks[0]?.contentHash);
    assert.equal(chunks[0]?.contentHash, computeSha256(chunks[0]?.content ?? ''));
  });

  await t.test('2. Incremental document ingestion: identical content is NOOP', () => {
    const doc1 = livingCompiler.ingestion.ingest({
      id: 'doc-1',
      title: 'Attention Paper',
      content: '# Intro\n\nInitial content.',
    });
    assert.equal(doc1.version, 1);
    assert.equal(doc1.isNewVersion, true);

    // Re-ingest same content -> version remains 1, isNewVersion false
    const doc2 = livingCompiler.ingestion.ingest({
      id: 'doc-1',
      title: 'Attention Paper',
      content: '# Intro\n\nInitial content.',
    });
    assert.equal(doc2.version, 1);
    assert.equal(doc2.isNewVersion, false);

    // Ingest updated content -> version increments to 2
    const doc3 = livingCompiler.ingestion.ingest({
      id: 'doc-1',
      title: 'Attention Paper',
      content: '# Intro\n\nUpdated content with more details.',
    });
    assert.equal(doc3.version, 2);
    assert.equal(doc3.isNewVersion, true);
  });

  await t.test('3. Entity resolution merges surface forms into single canonical node', () => {
    const resolver = new EntityResolver(db);

    const first = resolver.resolve('Self Attention');
    const second = resolver.resolve('self-attention');
    resolver.addAlias(first.id, 'self attention mechanism');

    const third = resolver.resolve('self attention mechanism');

    assert.equal(first.id, second.id);
    assert.equal(first.id, third.id);
  });

  await t.test('4. Claims and Evidence tracking connects statements to real chunks', () => {
    const claims = new ClaimService(db);
    const evidence = new EvidenceService(db);

    const doc = livingCompiler.ingestion.ingest({
      id: 'doc-claims',
      title: 'Claims Source',
      content: '# Self Attention\n\nSelf attention weights tokens across sequence.',
    });
    const chunkId = doc.chunks[0]?.id ?? '';
    assert.ok(chunkId);

    const claim = claims.recordClaim('self-attention', 'Self attention weights tokens across sequence.');
    assert.ok(claim.id);

    const link = evidence.linkEvidence(claim.id, chunkId, 'Self attention weights tokens');
    assert.equal(link.claimId, claim.id);
    assert.equal(link.documentChunkId, chunkId);

    const nodeEvidence = evidence.getEvidenceForNode('self-attention');
    assert.ok(nodeEvidence.some((e) => e.documentChunkId === chunkId));
  });

  await t.test('5. Versioned ArtifactCompiler compiles and updates canonical schema', () => {
    const artifacts = livingCompiler.artifacts;
    const initial = artifacts.compile('self-attention', 'Self Attention');
    assert.equal(initial.version, 1);
    assert.equal(initial.content.nodeId, 'self-attention');
    assert.ok(initial.content.definition);

    // Recompiling with same evidence/claims -> NOOP (isNewVersion: false)
    const recompiled = artifacts.compile('self-attention', 'Self Attention');
    assert.equal(recompiled.version, 1);
    assert.equal(recompiled.isNewVersion, false);
  });

  await t.test('6. SQLite FTS5 agentic retrieval tools return structured items', async () => {
    await livingCompiler.ingestAndCompile({
      id: 'doc-attention',
      title: 'Attention Is All You Need',
      content: `# Self Attention\n\nSelf attention enables direct token interactions across sequences.\n\n# Softmax Normalization\n\nSoftmax transforms logits into normalized probability distribution.`,
    });

    const searchResults = livingCompiler.retrieval.knowledgeSearch('softmax');
    assert.ok(searchResults.length > 0);
    assert.ok(searchResults.some((r) => r.title.toLowerCase().includes('softmax')));

    const artifact = livingCompiler.retrieval.artifactRead('softmax-normalization');
    assert.ok(artifact);
    assert.equal(artifact?.title, 'Softmax Normalization');

    const chunkResults = livingCompiler.retrieval.sourceSearch('logits');
    assert.ok(chunkResults.length > 0);
  });

  await t.test('7. RetrievalTracker enforces budget limits', () => {
    const tracker = new RetrievalTracker(RetrievalBudgetLevel.Standard);
    assert.equal(tracker.remaining, 2);

    tracker.consumeStep('knowledge_search', 'attention', 2);
    assert.equal(tracker.remaining, 1);

    tracker.consumeStep('artifact_read', 'self-attention', 1);
    assert.equal(tracker.remaining, 0);

    assert.throws(() => {
      tracker.consumeStep('source_search', 'logits');
    }, /Retrieval budget exceeded/);
  });
});
