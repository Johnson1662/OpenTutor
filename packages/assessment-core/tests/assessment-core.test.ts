import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentEvaluator, CourseCompiler, MasteryPolicy } from '../src/index.ts';

describe('@opentutor/assessment-core', () => {
  it('does not mark a correct answer mastered before the threshold', () => {
    const policy = new MasteryPolicy();
    const state = policy.apply({ confidence: 0 }, 'correct');
    assert.equal(state.confidence, 0.25);
    assert.equal(state.status, 'weak');
    assert.notEqual(state.status, 'mastered');
  });

  it('transitions through confidence thresholds deterministically', () => {
    const policy = new MasteryPolicy();
    assert.equal(policy.statusForConfidence(0), 'unknown');
    assert.equal(policy.statusForConfidence(0.2), 'weak');
    assert.equal(policy.statusForConfidence(0.5), 'learning');
    assert.equal(policy.statusForConfidence(0.8), 'mastered');
    assert.equal(policy.apply({ confidence: 0.7 }, 'correct').status, 'mastered');
    assert.equal(policy.apply({ confidence: 0.8 }, 'incorrect').status, 'learning');
  });

  it('grades objective answers and open answers without a network call and separates score from evidenceConfidence', () => {
    const evaluator = new AssessmentEvaluator();
    const correctObj = evaluator.evaluateObjective({ type: 'single', correctAnswer: 'B' }, 'b');
    assert.equal(correctObj.result, 'correct');
    assert.equal(correctObj.score, 1);
    assert.equal(correctObj.evidenceConfidence, 1.0);
    assert.equal(correctObj.confidence, 1.0);

    const incorrectObj = evaluator.evaluateObjective({ type: 'single', correctAnswer: 'B' }, 'a');
    assert.equal(incorrectObj.result, 'incorrect');
    assert.equal(incorrectObj.score, 0);
    assert.equal(incorrectObj.evidenceConfidence, 1.0);
    assert.equal(incorrectObj.confidence, 1.0);

    const partialObj = evaluator.evaluateObjective({ type: 'multiple', correctAnswers: ['A', 'C'] }, ['A']);
    assert.equal(partialObj.result, 'partial');
    assert.equal(partialObj.score, 0.5);
    assert.equal(partialObj.evidenceConfidence, 1.0);

    const openEval = evaluator.evaluateOpenAnswer('Keys and values are weighted to gather context', { expectedKeywords: ['keys', 'values', 'context'] });
    assert.equal(openEval.result, 'correct');
    assert.equal(openEval.evidenceConfidence, 1.0);

    const substringTrap = evaluator.evaluateOpenAnswer('The answer contains keywords only', { expectedKeywords: ['word'] });
    assert.equal(substringTrap.score, 0);
    assert.equal(substringTrap.result, 'incorrect');

  });
  it('orders prerequisites stably and filters mastered nodes', () => {
    const compiler = new CourseCompiler();
    const nodes = [{ id: 'goal' }, { id: 'middle' }, { id: 'root' }, { id: 'other' }];
    const edges = [{ from: 'root', to: 'middle' }, { from: 'middle', to: 'goal' }];
    assert.deepEqual(compiler.compileNodeIds(nodes, edges, ['goal']), ['root', 'middle', 'goal']);
    assert.deepEqual(compiler.compileNodeIds(nodes, edges, ['goal'], ['middle']), ['root', 'goal']);
  });
});
