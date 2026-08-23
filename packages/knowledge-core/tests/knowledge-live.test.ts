import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '@opentutor/database';
import {
  createOpenTutorModelRuntime,
  ModelSelectionService,
  RoleModelResolver,
  PiModelDriver,
  DefaultModelExecutionService,
  ModelPreferencesRepository,
} from '@opentutor/model-runtime';
import {
  LivingKnowledgeCompiler,
  ModelKnowledgeAnalyzer,
  ModelArtifactSynthesizer,
} from '../src/index.ts';

test('packages/knowledge-core - Live Knowledge Compiler Integration Test', async (t) => {
  const runtime = await createOpenTutorModelRuntime();
  const available = await runtime.getAvailable();

  if (available.length === 0) {
    t.skip('No live AI credentials or models available');
    return;
  }

  const db = createDatabase(':memory:');
  const prefsRepo = new ModelPreferencesRepository(db);
  const first = available[0];
  if (first) {
    prefsRepo.setPreferences('default-user', {
      defaultProviderId: first.provider,
      defaultModelId: first.id,
      thinkingLevel: 'off',
    });
  }

  const selectionService = new ModelSelectionService(runtime, prefsRepo);
  const roleResolver = new RoleModelResolver(selectionService, runtime, prefsRepo);
  const driver = new PiModelDriver(runtime);
  const executionService = new DefaultModelExecutionService(roleResolver, driver);

  const analyzer = new ModelKnowledgeAnalyzer(executionService);
  const synthesizer = new ModelArtifactSynthesizer(executionService);
  const compiler = new LivingKnowledgeCompiler(db, analyzer, synthesizer);

  await t.test('Extracts grounded knowledge from Markdown using real AI model', async () => {
    const result = await compiler.ingestAndCompile({
      id: 'doc-live-test',
      title: 'Attention Fundamentals',
      content: `# Self-Attention Mechanism\n\nSelf-attention allows tokens in a sequence to attend to all other positions dynamically.\n\n# Softmax Activation\n\nSoftmax transforms vector logits into a normalized probability distribution where components sum to 1.`,
    });

    assert.ok(result.compiledArtifacts.length >= 2);
    const firstArt = result.compiledArtifacts[0];
    assert.ok(firstArt?.content.definition.text);
    assert.ok(firstArt?.content.definition.claimIds.length > 0);
  });

  t.after(() => {
    setImmediate(() => {
      process.exit(0);
    });
  });
});
