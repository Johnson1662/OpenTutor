# 01 — Database Migrations and Domain Invariants Hardening

**What to build:** An embedded SQLite migration runner in `@opentutor/database` and hardened domain state machines for Lessons (rejecting duplicate IDs, non-existent targets, stale versions) and Learning Paths (enforcing the strict single-current node invariant).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Implement `packages/database/src/migration-runner.ts` with `schema_migrations` tracking
- [ ] Migrate base schemas into sequential migration scripts (`001_initial.ts`, `002_domain_invariants.ts`)
- [ ] Implement strict `LessonPatch` validation in `LessonRepository` (reject duplicate IDs, non-existent target references, empty patches, ID/type mutations)
- [ ] Implement single-current state machine in `SessionRepository` with semantic methods: `insertDetour` (places detour before active node, sets detour as `current`, previous as `upcoming`), `completeCurrentNode`, `resumeMainPath`
- [ ] Add unit tests in `packages/database/tests/migrations-and-invariants.test.ts`
