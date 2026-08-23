# 03 — Tutor Runtime Abstraction, Session Decoupling, and Observability

**What to build:** Formalize `TutorRuntime` (`FakeTutorRuntime` & `PiTutorRuntime`), decouple agent sessions from domain state, persist execution traces in `agent_runs` and `agent_tool_calls`, and unify quick actions with chat messages.

**Blocked by:** 02 — Capability Segregation, Single-Source Tool Schemas, and Atomic Events

**Status:** ready-for-agent

- [ ] Define `TutorRuntime` interface with `runTurn`, `cancel`, `disposeSession`
- [ ] Implement `FakeTutorRuntime` for testing and `PiTutorRuntime` wrapping Pi AgentSession
- [ ] Add migrations for `agent_sessions`, `agent_runs`, and `agent_tool_calls` tables
- [ ] Record agent reasoning boundaries and tool call traces on every turn
- [ ] Verify zero coding tools (`bash`, `write`, `edit`) are exposed to the agent session
- [ ] Unify `/actions` and `/messages` to route through the unified `TutorRuntime`
