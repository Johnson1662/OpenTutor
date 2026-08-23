# 06 — Assessment Engine and MasteryPolicy

**What to build:** Implement deterministic objective quiz grading, LLM-based open answer rubric evaluation, and an evidence-based `MasteryPolicy` mapping confidence scores to state transitions (`unknown` / `learning` / `weak` / `mastered`).

**Blocked by:** 05 — SQLite FTS5 Agentic Retrieval Tools and Search Budgets

**Status:** ready-for-agent

- [ ] Implement `AssessmentEvaluator` for objective (choices) and open answer diagnostic scoring
- [ ] Implement `MasteryPolicy` domain rule calculating confidence updates from assessment evidence
- [ ] Ensure single correct answer does not instantly jump to `mastered` without meeting threshold
- [ ] Write unit tests verifying mastery state transitions and edge cases
