import type { ModelDriver } from './model-driver.ts';
import type { ResolvedRoleModel } from '../role-model-resolver.ts';

export type FakeResponseGenerator = (
  resolved: ResolvedRoleModel,
  prompt: string,
  system?: string
) => string | Promise<string>;

export class FakeModelDriver implements ModelDriver {
  private readonly generator?: FakeResponseGenerator;

  constructor(generator?: FakeResponseGenerator) {
    this.generator = generator;
  }

  async complete(
    resolved: ResolvedRoleModel,
    prompt: string,
    system?: string
  ): Promise<string> {
    if (this.generator) {
      return await this.generator(resolved, prompt, system);
    }

    if (prompt.includes('valid JSON object') || prompt.includes('schema')) {
      return JSON.stringify({
        summary: `Fake summary for ${resolved.role}`,
        items: [],
        confidence: 1.0,
      });
    }

    return `[FakeModelDriver ${resolved.providerId}/${resolved.modelId} for ${resolved.role}]: ${prompt.slice(0, 100)}`;
  }
}
