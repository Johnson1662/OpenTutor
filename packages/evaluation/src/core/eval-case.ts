export interface EvalCase<TInput = unknown, TExpected = unknown> {
  id: string;
  domain: string;
  description?: string;
  input: TInput;
  expected: TExpected;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MetricResult {
  name: string;
  value: number;
  threshold?: number;
  passed: boolean;
  details?: unknown;
}

export interface HardFailure {
  rule: string;
  message: string;
  details?: unknown;
}

export interface EvalResult {
  caseId: string;
  domain: string;
  hardFailures: HardFailure[];
  metrics: MetricResult[];
  passed: boolean;
  durationMs?: number;
  details?: unknown;
}

export interface EvalSuiteResult {
  name: string;
  totalCases: number;
  passedCases: number;
  hardFailureCount: number;
  metrics: Record<string, number>;
  passed: boolean;
  results: EvalResult[];
  durationMs?: number;
}
