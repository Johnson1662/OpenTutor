export const RetrievalBudgetLevel = {
  None: 0,
  Standard: 2,
  Deep: 5,
} as const;

export type RetrievalBudgetLevel = (typeof RetrievalBudgetLevel)[keyof typeof RetrievalBudgetLevel];

export class RetrievalTracker {
  private readonly maxSteps: number;
  private currentSteps = 0;
  private readonly trace: Array<{ tool: string; query?: string; resultCount: number }> = [];

  constructor(budget: number = RetrievalBudgetLevel.Standard) {
    this.maxSteps = budget;
  }

  consumeStep(tool: string, query?: string, resultCount: number = 0): void {
    if (this.currentSteps >= this.maxSteps) {
      throw new Error(`Retrieval budget exceeded: maximum allowed steps is ${this.maxSteps}`);
    }
    this.currentSteps++;
    this.trace.push({ tool, query, resultCount });
  }

  get steps(): number {
    return this.currentSteps;
  }

  get remaining(): number {
    return Math.max(0, this.maxSteps - this.currentSteps);
  }

  get executionTrace(): ReadonlyArray<{ tool: string; query?: string; resultCount: number }> {
    return this.trace;
  }
}
