import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '@opentutor/database';
import { EntityResolver, KnowledgeCompiler, KnowledgeRetriever, parseMarkdown } from '../src/index.ts';

test('parses markdown and deduplicates ingestion', () => {
  const db = createDatabase(':memory:');
  const compiler = new KnowledgeCompiler(db);
  assert.equal(parseMarkdown('# Heading\n\nBody').length, 1);
  const first = compiler.ingest({ id: 'doc-1', title: 'Doc', content: '# Heading\n\nBody' });
  const second = compiler.ingest({ id: 'doc-1', title: 'Doc', content: '# Heading\n\nBody' });
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(second.chunks[0]?.content, 'Body');
});

test('resolves entities and reads source chunks', () => {
  const db = createDatabase(':memory:');
  const compiler = new KnowledgeCompiler(db);
  const resolver = new EntityResolver(db);
  const entity = resolver.resolve('Transformers');
  assert.equal(resolver.resolve('transformers').id, entity.id);
  const doc = compiler.ingest({ title: 'Doc', content: 'A fact.' });
  assert.equal(new KnowledgeRetriever(db).sourceRead(doc.chunks[0]?.id ?? '')?.content, 'A fact.');
});
