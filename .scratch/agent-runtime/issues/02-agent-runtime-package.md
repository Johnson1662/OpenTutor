# 02 — Agent Runtime Package (@opentutor/agent-runtime)

**What to build:** An LLM-backed Agent Runtime package providing `TutorAgent` with tool-calling loop, system prompt configuration, conversational context, and deterministic testing support.

**Blocked by:** 01 — Domain Tools Package (@opentutor/agent-tools)

**Status:** ready-for-agent

- [ ] Create `packages/agent-runtime` in workspace
- [ ] Implement `TutorAgent` with Socratic Tutor system prompt (Alvar pedagogical principles)
- [ ] Implement LLM tool calling loop (OpenAI-compatible client with fallback provider)
- [ ] Add unit tests verifying tool dispatching, streaming deltas, and lifecycle events
