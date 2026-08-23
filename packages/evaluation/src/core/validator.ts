import type { HardFailure } from './eval-case.ts';

export interface ValidationContext {
  caseId?: string;
  domain?: string;
  metadata?: Record<string, unknown>;
}

export interface HardValidator<TActual = unknown, TExpected = unknown> {
  name: string;
  validate(actual: TActual, expected: TExpected, context?: ValidationContext): Promise<HardFailure[]> | HardFailure[];
}

export function createValidator<TActual, TExpected>(
  name: string,
  validateFn: (actual: TActual, expected: TExpected, context?: ValidationContext) => HardFailure[] | Promise<HardFailure[]>
): HardValidator<TActual, TExpected> {
  return {
    name,
    validate: validateFn,
  };
}

export async function runHardValidators<TActual, TExpected>(
  validators: HardValidator<TActual, TExpected>[],
  actual: TActual,
  expected: TExpected,
  context?: ValidationContext
): Promise<HardFailure[]> {
  const failures: HardFailure[] = [];

  for (const validator of validators) {
    try {
      const result = await validator.validate(actual, expected, context);
      if (Array.isArray(result) && result.length > 0) {
        failures.push(...result);
      }
    } catch (err: unknown) {
      failures.push({
        rule: validator.name,
        message: `Validator threw an unhandled exception: ${err instanceof Error ? err.message : String(err)}`,
        details: err,
      });
    }
  }

  return failures;
}

export function assertNoForbiddenMerges(
  mergedEntities: Array<Iterable<string> | string[]>,
  forbiddenPairs: Array<[string, string] | string[]>
): HardFailure[] {
  const failures: HardFailure[] = [];
  for (const [a, b] of forbiddenPairs) {
    const normA = a.trim().toLowerCase();
    const normB = b.trim().toLowerCase();
    for (const group of mergedEntities) {
      const normGroup = new Set(Array.from(group).map((s) => s.trim().toLowerCase()));
      if (normGroup.has(normA) && normGroup.has(normB)) {
        failures.push({
          rule: 'NO_FORBIDDEN_MERGES',
          message: `Forbidden merge detected between "${a}" and "${b}" in entity cluster [${Array.from(group).join(', ')}]`,
          details: { forbiddenPair: [a, b], cluster: Array.from(group) },
        });
      }
    }
  }
  return failures;
}

export function assertAcyclic(
  nodes: string[],
  edges: Array<{ from: string; to: string } | [string, string]>
): HardFailure[] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n, []);
  }
  for (const edge of edges) {
    const from = Array.isArray(edge) ? edge[0] : edge.from;
    const to = Array.isArray(edge) ? edge[1] : edge.to;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }

  const visited = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  const cyclePath: string[] = [];

  function dfs(curr: string, path: string[]): boolean {
    visited.set(curr, 1);
    path.push(curr);
    for (const neighbor of adj.get(curr) ?? []) {
      if (visited.get(neighbor) === 1) {
        cyclePath.push(...path.slice(path.indexOf(neighbor)), neighbor);
        return true;
      }
      if (!visited.get(neighbor) || visited.get(neighbor) === 0) {
        if (dfs(neighbor, path)) return true;
      }
    }
    path.pop();
    visited.set(curr, 2);
    return false;
  }

  for (const n of nodes) {
    if (!visited.get(n) || visited.get(n) === 0) {
      if (dfs(n, [])) {
        return [
          {
            rule: 'NO_CYCLES',
            message: `Cyclic dependency detected: ${cyclePath.join(' -> ')}`,
            details: { cycle: cyclePath },
          },
        ];
      }
    }
  }

  return [];
}

export function assertPrerequisiteClosure(
  includedNodeIds: Set<string> | string[],
  prerequisitesMap: Map<string, string[]> | Record<string, string[]>
): HardFailure[] {
  const included = new Set(includedNodeIds);
  const failures: HardFailure[] = [];
  const getPrereqs = (id: string): string[] => {
    if (prerequisitesMap instanceof Map) {
      return prerequisitesMap.get(id) ?? [];
    }
    return (prerequisitesMap as Record<string, string[]>)[id] ?? [];
  };

  for (const id of included) {
    const prereqs = getPrereqs(id);
    for (const req of prereqs) {
      if (!included.has(req)) {
        failures.push({
          rule: 'PREREQUISITE_CLOSURE',
          message: `Node "${id}" requires prerequisite "${req}", which is not included in the plan`,
          details: { node: id, missingPrerequisite: req },
        });
      }
    }
  }
  return failures;
}
