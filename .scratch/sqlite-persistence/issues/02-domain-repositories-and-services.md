# 02 — Domain Repositories and Services

**What to build:** Domain repositories and services in `packages/database` or `apps/server/src/services` that implement atomic operations for Lessons (with versioning & patch validation), Learning Paths (with Detour insertion), and Knowledge States (with Assessment calculation).

**Blocked by:** 01 — Database Package and SQLite Relational Schema

**Status:** ready-for-agent

- [ ] Implement `LessonRepository` / `LessonService`: fetch lesson by ID, apply atomic `LessonPatch[]` with optimistic concurrency check (`baseVersion`), and persist snapshot in `lesson_versions`
- [ ] Implement `SessionRepository` / `SessionService`: fetch session snapshot, update active node, apply `LearningPathPatch[]` (insert detour, update status)
- [ ] Implement `KnowledgeRepository` / `KnowledgeService`: record `Assessment` evaluations and calculate/update `user_knowledge_states`
- [ ] Implement `EventRepository`: durable event log persisting `learning_events` with monotonic `seq`
- [ ] Write integration test verifying patch version conflict rejection and atomic state update
