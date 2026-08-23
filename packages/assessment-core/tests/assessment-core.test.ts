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

  it('grades objective answers and open answers without a network call', () => {
    const evaluator = new AssessmentEvaluator();
    assert.equal(evaluator.evaluateObjective({ type: 'single', correctAnswer: 'B' }, 'b').result, 'correct');
    assert.equal(evaluator.evaluateObjective({ type: 'multiple', correctAnswers: ['A', 'C'] }, ['A']).result, 'partial');
    assert.equal(evaluator.evaluateOpenAnswer('Keys and values are weighted to gather context', { expectedKeywords: ['keys', 'values', 'context'] }).result, 'correct');
  });

  it('orders prerequisites stably and filters mastered nodes', () => {
    const compiler = new CourseCompiler();
    const nodes = [{ id: 'goal' }, { id: 'middle' }, { id: 'root' }, { id: 'other' }];
    const edges = [{ from: 'root', to: 'middle' }, { from: 'middle', to: 'goal' }];
    assert.deepEqual(compiler.compileNodeIds(nodes, edges, ['goal']), ['root', 'middle', 'goal']);
    assert.deepEqual(compiler.compileNodeIds(nodes, edges, ['goal'], ['middle']), ['root', 'goal']);
  });
});
