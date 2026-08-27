import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';

export interface OpenTutorModelRuntimeOptions {
  dataDir?: string;
  authPath?: string;
  modelsPath?: string;
}

export async function createOpenTutorModelRuntime(
  options: OpenTutorModelRuntimeOptions = {}
): Promise<ModelRuntime> {
  const dataDir = options.dataDir ?? process.env.OPENTUTOR_DATA_DIR ?? join(homedir(), '.opentutor');
  const inMemory = dataDir === ':memory:' || options.authPath === ':memory:' || options.modelsPath === ':memory:';
  const piDir = join(dataDir, 'pi');

  if (!inMemory) {
    try {
      mkdirSync(piDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  const inMemoryAuth = inMemory;
  const authPath = inMemoryAuth ? undefined : (options.authPath ?? join(piDir, 'auth.json'));
  const modelsPath = resolveModelsJsonPath(options);

  return await ModelRuntime.create({
    credentials: inMemoryAuth ? new InMemoryCredentialStore() : undefined,
    authPath,
    modelsPath,
  });
}

/** Persistent location of the pi models.json custom-provider file, or null for in-memory runs. */
export function resolveModelsJsonPath(options: OpenTutorModelRuntimeOptions = {}): string | null {
  const dataDir = options.dataDir ?? process.env.OPENTUTOR_DATA_DIR ?? join(homedir(), '.opentutor');
  const inMemory = dataDir === ':memory:' || options.authPath === ':memory:' || options.modelsPath === ':memory:';
  if (inMemory) return null;
  const piDir = join(dataDir, 'pi');
  return options.modelsPath ?? join(piDir, 'models.json');
}
