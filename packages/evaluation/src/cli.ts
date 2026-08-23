import { parseArgs } from 'node:util';
import * as path from 'node:path';
import {
  KnowledgeEvalSuite,
  CourseEvalSuite,
  LessonEvalSuite,
  TutorEvalSuite,
  LearnerEvalSuite,
  formatTerminalReport,
  generateJsonReport,
  type EvalSuiteResult,
} from './index.ts';

interface ParsedCliArgs {
  suite: string;
  domain: string;
  out: string;
  help?: boolean;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = {
    suite: { type: 'string' as const, short: 's', default: 'all' },
    domain: { type: 'string' as const, short: 'd', default: 'all' },
    out: { type: 'string' as const, short: 'o', default: 'eval-report.json' },
    help: { type: 'boolean' as const, short: 'h', default: false },
  };

  const { values } = parseArgs({ args: argv, options, allowPositionals: true });

  if (values.help) {
    console.log(`
OpenTutor Evaluation Runner

Usage:
  node --experimental-strip-types packages/evaluation/src/cli.ts [options]

Options:
  --suite, -s   Suite to run: all | knowledge | course | lesson | tutor | learner (default: all)
  --domain, -d  Domain to evaluate: all | transformer | csapp | cpp (default: all)
  --out, -o     Path to write JSON evaluation report (default: eval-report.json)
  --help, -h    Display this help message
`);
    return 0;
  }

  const selectedSuite = values.suite ?? 'all';
  const selectedDomain = values.domain ?? 'all';
  const outputPath = path.resolve(process.cwd(), values.out ?? 'eval-report.json');

  console.log(`[OpenTutor Eval] Running suite: '${selectedSuite}' | domain: '${selectedDomain}'...`);

  const suiteResults: EvalSuiteResult[] = [];

  // 1. Knowledge Compiler Suite
  if (selectedSuite === 'all' || selectedSuite === 'knowledge') {
    console.log(`[Eval] Executing Knowledge Compiler Evaluation Suite...`);
    const knowledgeSuite = new KnowledgeEvalSuite();
    const result = await knowledgeSuite.runSuite(selectedDomain);
    suiteResults.push(result);
  }

  // 2. Course Compiler Suite
  if (selectedSuite === 'all' || selectedSuite === 'course') {
    console.log(`[Eval] Executing Course Compiler Evaluation Suite...`);
    const courseSuite = new CourseEvalSuite();
    const result = await courseSuite.runSuite(selectedDomain);
    suiteResults.push(result);
  }

  // 3. Lesson Quality Suite
  if (selectedSuite === 'all' || selectedSuite === 'lesson') {
    console.log(`[Eval] Executing Lesson Quality Evaluation Suite...`);
    const lessonSuite = new LessonEvalSuite();
    const result = await lessonSuite.runSuite(selectedDomain);
    suiteResults.push(result);
  }

  // 4. Tutor Behavior Suite
  if (selectedSuite === 'all' || selectedSuite === 'tutor') {
    console.log(`[Eval] Executing Tutor Behavior Evaluation Suite...`);
    const tutorSuite = new TutorEvalSuite();
    const result = await tutorSuite.runSuite(selectedDomain);
    suiteResults.push(result);
  }

  // 5. Learner Model v2 Suite
  if (selectedSuite === 'all' || selectedSuite === 'learner') {
    console.log(`[Eval] Executing Learner Model v2 Evaluation Suite...`);
    const learnerSuite = new LearnerEvalSuite();
    const result = await learnerSuite.runSuite(selectedDomain);
    suiteResults.push(result);
  }

  // Formatted terminal output
  const terminalReport = formatTerminalReport(suiteResults);
  console.log('\n' + terminalReport);

  // Write JSON report
  generateJsonReport(suiteResults, outputPath);
  console.log(`[Eval] Detailed JSON report written to: ${outputPath}\n`);

  const allPassed = suiteResults.length > 0 && suiteResults.every((s) => s.passed);
  return allPassed ? 0 : 1;
}

if (process.argv[1] && (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'))) {
  runCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((err) => {
    console.error('[OpenTutor Eval Fatal Error]:', err);
    process.exit(1);
  });
}
