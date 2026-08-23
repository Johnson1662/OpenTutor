import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

export interface OpenTutorModelRuntimeOptions {
  dataDir?: string;
  authPath?: string;
  modelsPath?: string;
}

export async function createOpenTutorModelRuntime(
  options: OpenTutorModelRuntimeOptions = {}
): Promise<ModelRuntime> {
  const dataDir = options.dataDir ?? process.env.OPENTUTOR_DATA_DIR ?? join(homedir(), '.opentutor');
  const piDir = join(dataDir, 'pi');

  try {
    mkdirSync(piDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const authPath = options.authPath ?? join(piDir, 'auth.json');
  const modelsPath = options.modelsPath ?? join(piDir, 'models.json');

  return await ModelRuntime.create({
    authPath,
    modelsPath,
  });
}
