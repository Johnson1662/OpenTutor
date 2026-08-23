# Spec: SQLite Persistence and Domain Services Refactoring

## Problem Statement

Currently, OpenTutor's server holds all session state (active Lessons, Learning Paths, and event sequences) in an in-memory variable within `apps/server/src/index.ts`. When the server restarts, all user progress, knowledge evaluations, and lesson versions are permanently lost. Furthermore, relying on an external PostgreSQL service adds unnecessary operational friction for local development and edge deployment.

## Solution

Migrate OpenTutor's persistence layer to an embedded SQLite database hosted within `@opentutor/database`. Refactor the server architecture from a monolithic script into modular Domain Services (`CourseService`, `LessonService`, `SessionService`, `KnowledgeService`) backed by typed repositories. Ensure all Lesson Patches, Learning Path mutations, and Assessments are transactionally persisted and streamed to the client over an idempotent, resumable SSE event pipeline.

## User Stories

1. As a learner, I want my learning progress and completed knowledge states to persist across server restarts, so that I can resume studying where I left off.
2. As a learner, I want my active Lesson and its dynamically injected patches to be version-tracked, so that I never lose customized explanations or code blocks.
3. As a learner, I want any dynamically inserted Detour (prerequisite node) to be persisted in my Learning Path, so that my path remains coherent when I reconnect.
4. As a learner, I want my quiz submissions to be permanently recorded as Assessments and update my User Knowledge State in real-time, so that future lessons adapt to my mastery level.
5. As a frontend client, I want to fetch a complete `LearningSessionSnapshot` upon initial load or reconnection, so that I can instantly restore the full Learning Room state.
6. As a frontend client, I want SSE events to carry monotonic sequence numbers (`seq`), so that I can detect missed events and apply patches idempotently.
7. As an AI Tutor runtime, I want to execute typed tools (`lesson_patch`, `path_patch`, `assessment_record`) against clean service interfaces, so that I cannot corrupt database state or cause version conflicts.
8. As a developer, I want SQLite tables and migrations to run automatically on server boot, so that no external database daemon or manual setup is required.

## Implementation Decisions

- **Embedded Persistence**: Implement `@opentutor/database` using `better-sqlite3` (with WAL mode enabled for concurrent read performance and transactional write safety).
- **Relational Schema**: Create relational tables matching core domain entities:
  - `knowledge_nodes`, `knowledge_edges`, `user_knowledge_states`
  - `courses`, `course_nodes`, `course_edges`
  - `learning_sessions`, `learning_paths`, `learning_path_nodes`
  - `lessons`, `lesson_versions`
  - `assessments`, `learning_events`
- **Domain Service Architecture**: Split monolithic server logic into:
  - `SessionService`: Manages session lifecycle, path state, and snapshot delivery.
  - `LessonService`: Manages block mutations, version incrementing, and patch conflict resolution.
  - `KnowledgeService`: Manages user proficiency updates driven by diagnostic assessments.
  - `EventBus`: Centralized EventEmitter delivering SSE events to connected listeners with durable sequence logging.
- **Optimistic Concurrency**: All `LessonPatch` requests must supply a `baseVersion`. The server rejects stale requests with a `VERSION_CONFLICT` status if `baseVersion !== currentVersion`.
- **Zero Raw LLM SQL Access**: AI agent interactions strictly interface via typed service methods and domain tools.

## Testing Decisions

- **Testing Seam**: Test primarily at the Service and Repository boundary (integration tests with in-memory or temp-file SQLite databases) and secondarily at the HTTP API endpoint level.
- **Behavioral Focus**:
  - Test that applying a valid `LessonPatch` inserts/updates blocks and increments the lesson version atomically.
  - Test that a patch with a mismatched `baseVersion` fails with `VERSION_CONFLICT`.
  - Test that inserting a `Detour` updates `learning_path_nodes` and broadcasts a `path.patch` event.
  - Test that submitting a quiz answer persists an `Assessment` and updates `user_knowledge_states`.
  - Test that reconnecting with `lastAppliedSeq` recovers or streams all subsequent events.
- **Prior Art**: Protocol unit tests and server mock runtime harness.

## Out of Scope

- Pi SDK full LLM tool loop execution (to be connected in Phase 4).
- Document ingestion and Living Knowledge compilation pipeline (scheduled for Phase 6).
- Multi-user authentication and OAuth (single local user assumed for MVP).

## Further Notes

All database timestamps use ISO 8601 strings. JSON payloads (blocks, patches, metadata) are stored as typed JSON text columns in SQLite.
