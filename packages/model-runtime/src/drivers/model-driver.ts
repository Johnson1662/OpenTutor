import type { ResolvedRoleModel } from '../role-model-resolver.ts';

export interface ModelDriver {
  complete(resolved: ResolvedRoleModel, prompt: string, system?: string): Promise<string>;
}
