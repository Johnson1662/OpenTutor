import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import { DOMAIN_TOOLS_DEFINITIONS } from '@opentutor/agent-tools';

export const TUTOR_ALLOWED_TOOLS = new Set([
  'lesson_get',
  'lesson_patch',
  'path_get',
  'path_insert_detour',
  'path_advance',
  'knowledge_search',
  'artifact_read',
  'source_search',
  'source_read',
  'graph_neighbors',
]);

export const TUTOR_FORBIDDEN_TOOLS = new Set([
  'bash',
  'write',
  'edit',
  'read',
  'grep',
  'find',
  'ls',
]);

export interface PiTool {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details?: unknown }>;
}

export function createTutorTools(
  sessionId: string,
  toolsExecutor: DomainToolsExecutor,
  onToolStart?: (toolCallId: string, toolName: string) => void,
  onToolEnd?: (toolCallId: string, toolName: string, success: boolean) => void
): PiTool[] {
  const tools: PiTool[] = [];

  for (const def of DOMAIN_TOOLS_DEFINITIONS) {
    const name = def.function.name;

    if (TUTOR_FORBIDDEN_TOOLS.has(name) || !TUTOR_ALLOWED_TOOLS.has(name)) {
      continue;
    }

    tools.push({
      name,
      label: name,
      description: def.function.description,
      parameters: def.function.parameters as Record<string, unknown>,
      execute: async (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
        if (signal?.aborted) {
          throw new Error('Tool execution aborted');
        }

        onToolStart?.(toolCallId, name);
        const result = await toolsExecutor.executeTool(sessionId, name, params);
        onToolEnd?.(toolCallId, name, result.success);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          details: result,
        };
      },
    });
  }

  return tools;
}

export function validateTutorToolAllowlist(tools: readonly { name: string }[]): boolean {
  for (const tool of tools) {
    if (TUTOR_FORBIDDEN_TOOLS.has(tool.name)) {
      throw new Error(`Security Violation: Forbidden tool "${tool.name}" exposed to Tutor Agent`);
    }
    if (!TUTOR_ALLOWED_TOOLS.has(tool.name)) {
      throw new Error(`Security Violation: Tool "${tool.name}" is not in Tutor allowlist`);
    }
  }
  return true;
}
