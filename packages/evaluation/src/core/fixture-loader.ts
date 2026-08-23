import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DomainEntity {
  id: string;
  canonicalName: string;
  definition: string;
  keyClaims?: string[];
  aliases?: string[];
}

export interface DomainKnowledgeFixture {
  entities: DomainEntity[];
}

export interface CourseCaseFixture {
  id: string;
  goal: string;
  targetNodes: string[];
  expectedPrerequisites: string[];
  forbiddenNodes?: string[];
}

export interface LessonCaseFixture {
  id: string;
  topic: string;
  expectedConcepts: string[];
  expectedQuizObjectives: string[];
  expectedClaims: string[];
}

export interface TutorScenarioFixture {
  id: string;
  userMessage: string;
  contextTopic: string;
  expectedTools: string[];
  forbiddenTools: string[];
  expectedIntent?: string;
}

export interface DomainFixtureBundle {
  domain: string;
  sourceText: string;
  knowledge: DomainKnowledgeFixture;
  aliases: string[][];
  forbiddenMerges: string[][];
  relations: Array<{ from: string; to: string; type?: string }>;
  courseCases: CourseCaseFixture[];
  lessonCases: LessonCaseFixture[];
  tutorScenarios: TutorScenarioFixture[];
}

export function findEvalsDir(startDir: string = process.cwd()): string {
  let curr = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(curr, 'evals');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(startDir, 'evals');
}

export function loadDomainBundle(domain: string, evalsDir?: string): DomainFixtureBundle {
  const dir = path.join(evalsDir ?? findEvalsDir(), domain);
  if (!fs.existsSync(dir)) {
    throw new Error(`Domain eval directory not found: ${dir}`);
  }

  const readJson = <T>(filename: string, fallback: T): T => {
    const filepath = path.join(dir, filename);
    if (!fs.existsSync(filepath)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  };

  const sourcePath = path.join(dir, 'source.md');
  const sourceText = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf-8') : '';

  const knowledge = readJson<DomainKnowledgeFixture>('knowledge.json', { entities: [] });
  const aliases = readJson<string[][]>('aliases.json', []);
  const forbiddenMerges = readJson<string[][]>('forbidden-merges.json', []);
  const relations = readJson<Array<{ from: string; to: string; type?: string }>>('relations.json', []);
  const courseCases = readJson<CourseCaseFixture[]>('course-cases.json', []);
  const lessonCases = readJson<LessonCaseFixture[]>('lesson-cases.json', []);
  const tutorScenarios = readJson<TutorScenarioFixture[]>('tutor-scenarios.json', []);

  return {
    domain,
    sourceText,
    knowledge,
    aliases,
    forbiddenMerges,
    relations,
    courseCases,
    lessonCases,
    tutorScenarios,
  };
}

export function loadAllDomainBundles(evalsDir?: string): Record<string, DomainFixtureBundle> {
  const base = evalsDir ?? findEvalsDir();
  const domains = ['transformer', 'csapp', 'cpp'];
  const bundles: Record<string, DomainFixtureBundle> = {};

  for (const domain of domains) {
    if (fs.existsSync(path.join(base, domain))) {
      bundles[domain] = loadDomainBundle(domain, base);
    }
  }

  return bundles;
}
