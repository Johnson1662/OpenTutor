# 01 — Domain Tools Package (@opentutor/agent-tools)

**What to build:** A dedicated package defining typed tool definitions, JSON schemas, and execution handlers for OpenTutor's pedagogical domain tools (`lesson_get`, `lesson_patch`, `path_get`, `path_patch`, `assessment_record`, `knowledge_get`).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Create `packages/agent-tools` in workspace with `@opentutor/protocol` dependency
- [ ] Define schemas and JSON-Schema definitions for all 6 domain tools
- [ ] Implement `DomainToolsExecutor` executing tool payloads against Domain Services
- [ ] Add unit tests verifying argument validation and successful dispatching
