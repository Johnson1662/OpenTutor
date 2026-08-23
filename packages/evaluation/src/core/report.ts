import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvalSuiteResult } from './eval-case.ts';

export interface ComprehensiveReport {
  timestamp: string;
  totalSuites: number;
  passedSuites: number;
  totalCases: number;
  passedCases: number;
  totalHardFailures: number;
  passed: boolean;
  durationMs: number;
  suites: EvalSuiteResult[];
}

export function buildComprehensiveReport(suites: EvalSuiteResult[]): ComprehensiveReport {
  let totalCases = 0;
  let passedCases = 0;
  let totalHardFailures = 0;
  let totalDuration = 0;
  let passedSuites = 0;

  for (const s of suites) {
    totalCases += s.totalCases;
    passedCases += s.passedCases;
    totalHardFailures += s.hardFailureCount;
    totalDuration += s.durationMs ?? 0;
    if (s.passed) passedSuites++;
  }

  const passed = totalHardFailures === 0 && passedCases === totalCases && suites.length > 0;

  return {
    timestamp: new Date().toISOString(),
    totalSuites: suites.length,
    passedSuites,
    totalCases,
    passedCases,
    totalHardFailures,
    passed,
    durationMs: totalDuration,
    suites,
  };
}

export function formatTerminalReport(suites: EvalSuiteResult[]): string {
  const report = buildComprehensiveReport(suites);
  const lines: string[] = [];

  lines.push('================================================================================');
  lines.push('                      OPENTUTOR EVALUATION REPORT                               ');
  lines.push('================================================================================');
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Overall Status: ${report.passed ? '✓ PASSED' : '✗ FAILED'}`);
  lines.push(`Suites: ${report.passedSuites}/${report.totalSuites} passed | Cases: ${report.passedCases}/${report.totalCases} passed | Hard Failures: ${report.totalHardFailures}`);
  lines.push(`Total Duration: ${report.durationMs}ms`);
  lines.push('--------------------------------------------------------------------------------');

  for (const s of suites) {
    const badge = s.passed ? '[PASS]' : '[FAIL]';
    lines.push(`${badge} Suite: ${s.name} (${s.passedCases}/${s.totalCases} cases, ${s.hardFailureCount} hard failures, ${s.durationMs ?? 0}ms)`);

    if (Object.keys(s.metrics).length > 0) {
      const metricEntries = Object.entries(s.metrics)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      lines.push(`       Metrics: ${metricEntries}`);
    }

    for (const r of s.results) {
      const caseBadge = r.passed ? '  ✓' : '  ✗';
      lines.push(`  ${caseBadge} [${r.domain}] ${r.caseId} (${r.durationMs ?? 0}ms)`);

      if (r.hardFailures.length > 0) {
        for (const hf of r.hardFailures) {
          lines.push(`      [HARD FAILURE] ${hf.rule}: ${hf.message}`);
        }
      }

      if (r.metrics.length > 0) {
        for (const m of r.metrics) {
          const passIcon = m.passed ? '✓' : '✗';
          const thresh = m.threshold !== undefined ? ` (target >= ${m.threshold})` : '';
          lines.push(`      ${passIcon} ${m.name}: ${m.value}${thresh}`);
        }
      }
    }
    lines.push('--------------------------------------------------------------------------------');
  }

  return lines.join('\n');
}

export function generateJsonReport(suites: EvalSuiteResult[], outputPath?: string): string {
  const report = buildComprehensiveReport(suites);
  const jsonString = JSON.stringify(report, null, 2);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, jsonString, 'utf-8');
  }

  return jsonString;
}
