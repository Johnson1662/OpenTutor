import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelProbeGenerator } from '../src/index.ts';
import type { ModelExecutionServiceLike } from '../src/index.ts';

describe('ModelProbeGenerator', () => {
  it('generates deterministic probe QuizBlock with all required fields', async () => {
    const generator = new ModelProbeGenerator();

    const probe = await generator.generate({
      targetKnowledgeNodeId: 'matrix-multiplication',
      probeType: 'concept',
      difficulty: 'medium',
      nodeTitle: 'Matrix Multiplication',
    });

    assert.equal(probe.type, 'quiz');
    assert.equal(probe.assessmentKind, 'probe');
    assert.equal(probe.targetKnowledgeNodeId, 'matrix-multiplication');
    assert.ok(probe.id.startsWith('probe-matrix-multiplication-'));
    assert.equal(probe.answerType, 'single_choice');
    assert.ok(probe.question.length > 5);
    assert.ok(Array.isArray(probe.options));
    assert.ok(probe.options.length >= 2);
    assert.equal(probe.answerSpec?.type, 'single_choice');
    assert.ok(
      probe.options &&
        probe.answerSpec &&
        'correctOptionId' in probe.answerSpec &&
        probe.options.some((opt) => opt.id === (probe.answerSpec as any).correctOptionId),
      'correctOptionId must exist in options'
    );
    assert.equal(probe.difficulty, 'medium');
  });

  it('generates deterministic probe targeted at candidate misconceptions', async () => {
    const generator = new ModelProbeGenerator();

    const probe = await generator.generate({
      targetKnowledgeNodeId: 'pointer-arithmetic',
      candidateMisconceptionIds: ['misc-address-value-confusion'],
      probeType: 'misconception',
      difficulty: 'hard',
      nodeTitle: 'Pointer Arithmetic',
      misconceptions: [
        {
          id: 'misc-address-value-confusion',
          description: 'adding integers increments address by byte count instead of type size',
        },
      ],
    });

    assert.equal(probe.assessmentKind, 'probe');
    assert.equal(probe.targetKnowledgeNodeId, 'pointer-arithmetic');
    assert.deepEqual(probe.candidateMisconceptionIds, ['misc-address-value-confusion']);
    assert.equal(probe.difficulty, 'hard');
    assert.ok(probe.options!.some((o) => o.text.includes('type size') || o.text.includes('adding integers')));
  });

  it('generates distinct deterministic probe types (recall vs application)', async () => {
    const generator = new ModelProbeGenerator();

    const recallProbe = await generator.generate({
      targetKnowledgeNodeId: 'softmax',
      probeType: 'recall',
      nodeTitle: 'Softmax Activation',
    });
    assert.ok(recallProbe.question.toLowerCase().includes('definition'));

    const appProbe = await generator.generate({
      targetKnowledgeNodeId: 'softmax',
      probeType: 'application',
      nodeTitle: 'Softmax Activation',
    });
    assert.ok(appProbe.question.toLowerCase().includes('applied') || appProbe.question.toLowerCase().includes('scenario'));
  });

  it('uses ModelExecutionService when available and structured completion succeeds', async () => {
    const mockExecutionService: ModelExecutionServiceLike = {
      async completeStructured<T>() {
        return {
          question: 'What is the sum of probabilities output by the softmax function?',
          options: [
            { id: 'opt-a', text: 'Exactly 1.0' },
            { id: 'opt-b', text: 'Variable depending on temperature' },
            { id: 'opt-c', text: 'Zero' },
          ],
          correctOptionId: 'opt-a',
        } as unknown as T;
      },
    };

    const generator = new ModelProbeGenerator(mockExecutionService);
    const probe = await generator.generate({
      targetKnowledgeNodeId: 'softmax',
      candidateMisconceptionIds: ['misc-softmax-unnormalized'],
      nodeTitle: 'Softmax Activation',
    });

    assert.equal(probe.assessmentKind, 'probe');
    assert.equal(probe.targetKnowledgeNodeId, 'softmax');
    assert.equal(probe.question, 'What is the sum of probabilities output by the softmax function?');
    assert.equal(probe.options!.length, 3);
    assert.equal(probe.answerSpec?.type, 'single_choice');
    assert.equal((probe.answerSpec as any)?.correctOptionId, 'opt-a');
    assert.deepEqual(probe.candidateMisconceptionIds, ['misc-softmax-unnormalized']);
  });

  it('gracefully falls back to deterministic template when ModelExecutionService throws', async () => {
    const failingExecutionService: ModelExecutionServiceLike = {
      async completeStructured() {
        throw new Error('Model context exceeded');
      },
    };

    const generator = new ModelProbeGenerator(failingExecutionService);
    const probe = await generator.generate({
      targetKnowledgeNodeId: 'attention-weights',
      probeType: 'concept',
      nodeTitle: 'Attention Weights',
    });

    assert.equal(probe.assessmentKind, 'probe');
    assert.equal(probe.targetKnowledgeNodeId, 'attention-weights');
    assert.ok(probe.id.startsWith('probe-attention-weights-'));
    assert.ok(probe.options!.length >= 2);
  });
});
