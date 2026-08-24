import type { MetricComparator, MetricExpectation, MetricResult } from './eval-case.ts';

export function calculatePrecision(retrieved: Iterable<string>, groundTruth: Iterable<string>): number {
  const truthSet = new Set(Array.from(groundTruth).map((s) => s.trim().toLowerCase()));
  const retrievedArray = Array.from(retrieved).map((s) => s.trim().toLowerCase());
  if (retrievedArray.length === 0) return truthSet.size === 0 ? 1.0 : 0.0;

  let hits = 0;
  for (const item of retrievedArray) {
    if (truthSet.has(item)) {
      hits++;
    }
  }
  return hits / retrievedArray.length;
}

export function calculateRecall(retrieved: Iterable<string>, groundTruth: Iterable<string>): number {
  const truthArray = Array.from(groundTruth).map((s) => s.trim().toLowerCase());
  if (truthArray.length === 0) return 1.0;

  const retrievedSet = new Set(Array.from(retrieved).map((s) => s.trim().toLowerCase()));
  let hits = 0;
  for (const item of truthArray) {
    if (retrievedSet.has(item)) {
      hits++;
    }
  }
  return hits / truthArray.length;
}

export function calculateF1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0.0;
  return (2 * (precision * recall)) / (precision + recall);
}

export function calculateJaccard(setA: Iterable<string>, setB: Iterable<string>): number {
  const a = new Set(Array.from(setA).map((s) => s.trim().toLowerCase()));
  const b = new Set(Array.from(setB).map((s) => s.trim().toLowerCase()));
  if (a.size === 0 && b.size === 0) return 1.0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1.0 : intersection / union;
}

export function calculateGroundingScore(claims: Array<{ grounded: boolean } | boolean>): number {
  if (claims.length === 0) return 1.0;
  let groundedCount = 0;
  for (const c of claims) {
    const isGrounded = typeof c === 'boolean' ? c : c.grounded;
    if (isGrounded) groundedCount++;
  }
  return groundedCount / claims.length;
}

export function calculateTopologicalValidity(
  orderedNodes: string[],
  dependencyEdges: Array<{ from: string; to: string } | [string, string]>
): number {
  if (dependencyEdges.length === 0) return 1.0;
  const indexMap = new Map<string, number>();
  for (let i = 0; i < orderedNodes.length; i++) {
    indexMap.set(orderedNodes[i].trim().toLowerCase(), i);
  }

  let satisfied = 0;
  for (const edge of dependencyEdges) {
    const from = (Array.isArray(edge) ? edge[0] : edge.from).trim().toLowerCase();
    const to = (Array.isArray(edge) ? edge[1] : edge.to).trim().toLowerCase();

    const idxFrom = indexMap.get(from);
    const idxTo = indexMap.get(to);

    // If both nodes are in the sequence, 'from' (prerequisite) must appear before 'to' (dependent)
    if (idxFrom !== undefined && idxTo !== undefined) {
      if (idxFrom < idxTo) {
        satisfied++;
      }
    } else if (idxFrom === undefined && idxTo !== undefined) {
      // Missing prerequisite in sequence
      // Not satisfied
    } else {
      satisfied++;
    }
  }

  return satisfied / dependencyEdges.length;
}

const LOWER_IS_BETTER_PATTERNS = [
  'wrong_merge_rate',
  'wrong_tool_rate',
  'unnecessary_retrieval_rate',
  'unnecessary_detour_rate',
  'chat_dump_rate',
  'forbidden_node_rate',
  'hallucinated_evidence',
  'cycle_count',
];

export function createMetric(
  name: string,
  value: number,
  expectation?: number | MetricExpectation,
  details?: unknown
): MetricResult {
  const formattedValue = Number(value.toFixed(4));
  let metricExpectation: MetricExpectation | undefined;
  let threshold: number | undefined;

  if (typeof expectation === 'number') {
    threshold = expectation;
    const lowerName = name.toLowerCase();
    const lowerIsBetter =
      expectation === 0 ||
      LOWER_IS_BETTER_PATTERNS.some((p) => lowerName.includes(p.toLowerCase())) ||
      /^(wrong|unnecessary|forbidden|chat_dump|hallucinat|cycle_count)/i.test(lowerName);
    const op: MetricComparator = lowerIsBetter ? 'lte' : 'gte';
    metricExpectation = { op, value: expectation };
  } else if (expectation && typeof expectation === 'object') {
    metricExpectation = expectation;
    threshold = expectation.value;
  }

  let passed = true;
  if (metricExpectation) {
    switch (metricExpectation.op) {
      case 'gte':
        passed = formattedValue >= metricExpectation.value;
        break;
      case 'lte':
        passed = formattedValue <= metricExpectation.value;
        break;
      case 'eq':
        passed = formattedValue === metricExpectation.value;
        break;
      case 'gt':
        passed = formattedValue > metricExpectation.value;
        break;
      case 'lt':
        passed = formattedValue < metricExpectation.value;
        break;
      default:
        passed = formattedValue >= metricExpectation.value;
    }
  }

  return {
    name,
    value: formattedValue,
    threshold,
    expectation: metricExpectation,
    passed,
    details,
  };
}
