import type { SourceChunk } from '../source/markdown-parser.ts';

export interface BatchOptions {
  maxChunksPerBatch?: number;
  maxCharsPerBatch?: number;
}

export class AnalysisBatcher {
  private readonly maxChunks: number;
  private readonly maxChars: number;

  constructor(options: BatchOptions = {}) {
    this.maxChunks = options.maxChunksPerBatch ?? 6;
    this.maxChars = options.maxCharsPerBatch ?? 8000;
  }

  createBatches(chunks: SourceChunk[]): SourceChunk[][] {
    if (chunks.length === 0) return [];

    const batches: SourceChunk[][] = [];
    let currentBatch: SourceChunk[] = [];
    let currentChars = 0;

    for (const chunk of chunks) {
      const chunkChars = chunk.content.length + (chunk.heading?.length ?? 0);

      if (
        currentBatch.length >= this.maxChunks ||
        (currentBatch.length > 0 && currentChars + chunkChars > this.maxChars)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }

      currentBatch.push(chunk);
      currentChars += chunkChars;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }
}
