# 02 — Capability Segregation, Single-Source Tool Schemas, and Atomic Events

**What to build:** Refactor domain tools in `@opentutor/agent-tools` to separate capabilities (Tutor vs Assessment vs Compiler), eliminate manual duplicate schemas using TypeBox/typed validators, make DB mutations and Event append atomic in a single SQLite transaction, and wire `pnpm check`.

**Blocked by:** 01 — Database Migrations and Domain Invariants Hardening

**Status:** ready-for-agent

- [ ] Strip `assessment_record` and write-knowledge capabilities from Tutor Agent toolset
- [ ] Define single-source tool schemas with runtime validation
- [ ] Ensure `LessonRepository` and `SessionRepository` append `learning_events` atomically in the same database transaction
- [ ] Harden SSE replay and subscriber synchronization against race conditions; add heartbeat
- [ ] Configure root `pnpm check` script running all workspace typechecks, unit tests, integration tests, and builds
