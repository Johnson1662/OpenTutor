import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentEvaluator } from '../src/index.ts';

describe('@opentutor/assessment-core', () => {
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
});
