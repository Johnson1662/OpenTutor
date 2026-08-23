import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import {
  TUTOR_TOOL_DEFINITIONS,
  TUTOR_TOOL_NAMES,
  type DomainToolsExecutor,
} from '@opentutor/tutor-tools';

export interface OpenTutorExtensionOptions {
  sessionId: string;
  executor: DomainToolsExecutor;
  getTurnContext?: () => {
    requestId: string;
    retrieval: {
      consumeStep: (tool: string, query?: string) => void;
    };
  } | undefined;
  onToolStart?: (toolCallId: string, toolName: string) => void;
  onToolEnd?: (toolCallId: string, toolName: string, success: boolean) => void;
}

export function createOpenTutorExtension(
  options: OpenTutorExtensionOptions
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const definition of TUTOR_TOOL_DEFINITIONS) {
      pi.registerTool({
        name: definition.name,
        label: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        execute: async (
          toolCallId: string,
          params: unknown,
          signal?: AbortSignal
        ): Promise<AgentToolResult<unknown>> => {
          if (signal?.aborted) {
            throw new Error('Tool execution aborted');
          }

          if (definition.retrieval) {
            const turnContext = options.getTurnContext?.();
            if (turnContext?.retrieval) {
              try {
                const query =
                  typeof (params as Record<string, unknown>)?.query === 'string'
                    ? ((params as Record<string, unknown>).query as string)
                    : undefined;
                turnContext.retrieval.consumeStep(definition.name, query);
              } catch (budgetErr) {
                const errorMsg =
                  budgetErr instanceof Error ? budgetErr.message : 'RETRIEVAL_BUDGET_EXCEEDED';
                options.onToolStart?.(toolCallId, definition.name);
                options.onToolEnd?.(toolCallId, definition.name, false);
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        error: {
                          code: 'RETRIEVAL_BUDGET_EXCEEDED',
                          message: errorMsg,
                        },
                      }),
                    },
                  ],
                  details: {
                    success: false,
                    error: {
                      code: 'RETRIEVAL_BUDGET_EXCEEDED',
                      message: errorMsg,
                    },
                  },
                };
              }
            }
          }

          options.onToolStart?.(toolCallId, definition.name);
          const result = await options.executor.executeTool(
            options.sessionId,
            definition.name,
            params
          );
          options.onToolEnd?.(toolCallId, definition.name, result.success);

          if (result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result.data),
                },
              ],
              details: result,
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: result.error }),
                },
              ],
              details: result,
            };
          }
        },
      });
    }

    pi.on('tool_call', (event) => {
      if (!TUTOR_TOOL_NAMES.has(event.toolName)) {
        return {
          block: true,
          reason: `Security Violation: Tool "${event.toolName}" is not permitted in OpenTutor session`,
        };
      }
    });
  };
}
