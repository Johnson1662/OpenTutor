import type { ResolvedRoleModel } from '../model-execution-service.ts';

export interface ModelDriver {
  complete(resolved: ResolvedRoleModel, prompt: string, system?: string): Promise<string>;
}
