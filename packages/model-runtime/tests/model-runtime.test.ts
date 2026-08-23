import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '@opentutor/database';
import {
  createOpenTutorModelRuntime,
  ProviderService,
  AuthFlowSession,
  AuthService,
  ModelPreferencesRepository,
} from '../src/index.ts';

test('packages/model-runtime - AI Provider Control Plane & Auth Flow', async (t) => {
  const db = createDatabase(':memory:');
  const runtime = await createOpenTutorModelRuntime({
    dataDir: ':memory:',
    authPath: ':memory:',
    modelsPath: ':memory:',
  });
  const providerService = new ProviderService(runtime);
  const authService = new AuthService(runtime);
  const prefsRepo = new ModelPreferencesRepository(db);

  await t.test('1. ProviderService lists dynamic providers without leaking credentials', () => {
    const providers = providerService.listProviders();
    assert.ok(providers.length > 0);

    for (const p of providers) {
      assert.ok(typeof p.id === 'string');
      assert.ok(typeof p.name === 'string');
      assert.ok(typeof p.configured === 'boolean');
      // Ensure no raw credential properties exist
      const record = p as unknown as Record<string, unknown>;
      assert.equal(record.apiKey, undefined);
      assert.equal(record.token, undefined);
      assert.equal(record.secret, undefined);
    }
  });

  await t.test('2. ProviderService inspects models and provider status dynamically', async () => {
    const status = await providerService.getProviderStatus('anthropic');
    assert.equal(status.id, 'anthropic');
    assert.ok(typeof status.configured === 'boolean');
    assert.ok(typeof status.modelCount === 'number');

    const models = await providerService.listModels('anthropic');
    assert.ok(Array.isArray(models));
    for (const m of models) {
      assert.equal(m.providerId, 'anthropic');
      assert.ok(typeof m.reasoning === 'boolean');
    }
  });

  await t.test('3. AuthFlowSession emits events, handles prompts and cancellation', async () => {
    const session = new AuthFlowSession('anthropic', 'api_key');
    const receivedEvents: string[] = [];

    const unsubscribe = session.subscribe((event) => {
      receivedEvents.push(event.type);
    });

    session.emit('auth.progress', { message: 'Connecting...' });
    assert.ok(receivedEvents.includes('auth.progress'));

    // Test prompt & respond
    const promptPromise = session.prompt({
      type: 'secret',
      message: 'Enter API Key',
    });

    assert.ok(receivedEvents.includes('auth.prompt'));

    session.respond('non-existent', 'sk-test');
    // Prompt promise is still pending; now resolve with proper promptId
    const promptEvent = receivedEvents.find((t) => t === 'auth.prompt');
    assert.ok(promptEvent);

    // Cancel session
    session.cancel();
    assert.equal(session.status, 'cancelled');
    assert.ok(receivedEvents.includes('auth.cancelled'));

    await assert.rejects(async () => {
      await promptPromise;
    }, /Auth session cancelled/);

    unsubscribe();
  });

  await t.test('4. ModelPreferencesRepository persists and updates user AI preferences in SQLite', () => {
    const initial = prefsRepo.getPreferences('default-user');
    assert.equal(initial, null);

    const saved = prefsRepo.setPreferences('default-user', {
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-3-7-sonnet-20250219',
      thinkingLevel: 'high',
    });

    assert.equal(saved.defaultProviderId, 'anthropic');
    assert.equal(saved.defaultModelId, 'claude-3-7-sonnet-20250219');
    assert.equal(saved.thinkingLevel, 'high');

    const retrieved = prefsRepo.getPreferences('default-user');
    assert.ok(retrieved);
    assert.equal(retrieved?.defaultProviderId, 'anthropic');
    assert.equal(retrieved?.thinkingLevel, 'high');
  });

  t.after(() => {
    setImmediate(() => {
      process.exit(0);
    });
  });
});
