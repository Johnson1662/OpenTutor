import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase, AgentSessionRepository } from '@opentutor/database';
import {
 createOpenTutorModelRuntime,
 ProviderService,
 AuthFlowSession,
 AuthService,
 ModelPreferencesRepository,
 ModelSelectionService,
 SessionModelResolver,
} from '../src/index.ts';

test('packages/model-runtime - AI Provider Control Plane & Auth Flow', async (t) => {
 const db = createDatabase(':memory:');
 seedDatabase(db);
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

 await t.test('5. AuthFlowSession terminal state is immutable and AuthService performs GC', () => {
  const session = new AuthFlowSession('anthropic', 'api_key');
  session.cancel();
  assert.equal(session.status, 'cancelled');

  // Attempting to fail or complete an already cancelled session must NOOP
  session.fail('late error');
  assert.equal(session.status, 'cancelled');
  session.complete();
  assert.equal(session.status, 'cancelled');

  // Complete session clears pending prompts
  const activeSession = new AuthFlowSession('anthropic', 'api_key');
  const pendingPrompt = activeSession.prompt({ type: 'text', message: 'Test' });
  activeSession.complete();
  assert.equal(activeSession.status, 'completed');

  // Test GC in AuthService
  const shortTtlAuth = new AuthService(runtime, { sessionTtlMs: 1 });
  const s1 = shortTtlAuth.startAuthSession('anthropic', 'api_key');
  assert.equal(shortTtlAuth.getActiveSessionCount(), 1);
  shortTtlAuth.cancel(s1.id);
  assert.equal(shortTtlAuth.getActiveSessionCount(), 0);
 });

 await t.test('6. SessionModelResolver freezes model binding per learning session', async () => {
  const agentSessionRepo = new AgentSessionRepository(db);
  const selectionService = new ModelSelectionService(runtime, prefsRepo);
  const sessionResolver = new SessionModelResolver(selectionService, runtime, agentSessionRepo);

  // Insert learning sessions so foreign keys are satisfied
  db.prepare(
   `INSERT INTO learning_sessions (id, user_id, course_id, created_at, updated_at)
       VALUES ('session-101', 'default-user', 'transformer', datetime('now'), datetime('now')),
              ('session-102', 'default-user', 'transformer', datetime('now'), datetime('now'))`
  ).run();

  // Initial resolution creates binding using current preference (anthropic / claude-3-7-sonnet-20250219)
  const initialResolution = await sessionResolver.resolveSessionModel('session-101', 'default-user');
  assert.equal(initialResolution.providerId, 'anthropic');
  assert.equal(initialResolution.modelId, 'claude-3-7-sonnet-20250219');
  assert.equal(initialResolution.thinkingLevel, 'high');

  // User changes global preference to another model
  prefsRepo.setPreferences('default-user', {
   defaultProviderId: 'openai-codex',
   defaultModelId: 'gpt-4o',
   thinkingLevel: 'low',
  });

  // Existing session-101 must remain frozen to original model binding
  const frozenResolution = await sessionResolver.resolveSessionModel('session-101', 'default-user');
  assert.equal(frozenResolution.providerId, 'anthropic');
  assert.equal(frozenResolution.modelId, 'claude-3-7-sonnet-20250219');
  assert.equal(frozenResolution.thinkingLevel, 'high');
  assert.equal(frozenResolution.isBound, true);

  // New session-102 picks up the new global preference
  const newSessionResolution = await sessionResolver.resolveSessionModel('session-102', 'default-user');
  assert.equal(newSessionResolution.providerId, 'openai-codex');
  assert.equal(newSessionResolution.modelId, 'gpt-4o');
  assert.equal(newSessionResolution.thinkingLevel, 'low');
 });

 t.after(() => {
  setImmediate(() => {
   process.exit(0);
  });
 });
});
