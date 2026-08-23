# 01 — Database Package and SQLite Relational Schema

**What to build:** An embedded SQLite persistence layer in `packages/database` supporting schema migrations, connection initialization in WAL mode, and base seed data for standard Transformer Course and Knowledge Nodes.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Create `packages/database` in workspace with `better-sqlite3` and `@types/better-sqlite3`
- [ ] Implement schema migrations creating `knowledge_nodes`, `user_knowledge_states`, `courses`, `course_nodes`, `learning_sessions`, `learning_paths`, `learning_path_nodes`, `lessons`, `lesson_versions`, `assessments`, and `learning_events`
- [ ] Implement `DatabaseClient` with WAL mode, foreign keys enabled, and migration runner on startup
- [ ] Add seed data utility for default Transformer course and initial lesson blocks
- [ ] Verify database initialization and seed data loading via unit test
