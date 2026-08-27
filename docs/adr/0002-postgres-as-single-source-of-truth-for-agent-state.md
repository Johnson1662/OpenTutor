
> **Status: Superseded by [ADR-0003](0003-sqlite-as-primary-database.md)** — SQLite replaced PostgreSQL as the primary database. The state-authority principle below still holds; only the engine changed.

# 0002. PostgreSQL as Single Source of Truth for Learning State

AgentSession instances in the Pi Runtime represent ephemeral conversational and reasoning contexts, not application state. All business entities (Lessons, Lesson Versions, Learning Paths, User Knowledge States, and Assessments) are persisted in PostgreSQL with monotonically increasing sequence IDs and optimistic version locking, enabling zero-loss session recovery and idempotent SSE event streaming.
