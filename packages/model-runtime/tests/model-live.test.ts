import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { createDatabase, seedDatabase } from '@opentutor/database';
import {
  createOpenTutorModelRuntime,
  ModelPreferencesRepository,
  ModelSelectionService,
  RoleModelResolver,
  PiModelDriver,
  DefaultModelExecutionService,
} from '../src/index.ts';

test('packages/model-runtime - Live AI Model Integration Test', async (t) => {
  const modelRuntime = await createOpenTutorModelRuntime();
  const available = await modelRuntime.getAvailable();

  if (available.length === 0) {
    t.skip('No live AI credentials or models available');
    return;
  }

  const db = createDatabase(':memory:');
  seedDatabase(db);

  const prefsRepo = new ModelPreferencesRepository(db);
  const first = available[0];
  if (first) {
    prefsRepo.setPreferences('default-user', {
      defaultProviderId: first.provider,
      defaultModelId: first.id,
      thinkingLevel: 'off',
    });
  }

  const selectionService = new ModelSelectionService(modelRuntime, prefsRepo);
  const roleResolver = new RoleModelResolver(selectionService, modelRuntime, prefsRepo);
  const driver = new PiModelDriver(modelRuntime);
  const executionService = new DefaultModelExecutionService(roleResolver, driver);

  await t.test('1. completeText returns real response from available model', async () => {
    const response = await executionService.completeText({
      role: 'tutor',
      prompt: 'Respond with exactly the single word "READY".',
    });

    assert.ok(response && response.length > 0);
    assert.ok(response.toLowerCase().includes('ready'));
  });

  await t.test('2. completeStructured returns valid schema-conforming object', async () => {
    const PingSchema = Type.Object({
      status: Type.String(),
      version: Type.Number(),
    });

    const result = await executionService.completeStructured<{ status: string; version: number }>({
      role: 'tutor',
      prompt: 'Output a JSON object with status "ok" and version 1.',
      schema: PingSchema,
    });

    assert.equal(typeof result.status, 'string');
    assert.equal(typeof result.version, 'number');
  });
});
