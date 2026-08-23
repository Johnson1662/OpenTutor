# Spec: OpenTutor v0.3 — The Living Knowledge & AI Tutor Runtime

## Problem Statement

OpenTutor has achieved a functional prototype with SQLite persistence, SSE streaming, and a dynamic lesson canvas. However, the system currently lacks true pedagogical autonomy and living knowledge infrastructure. Specifically:
1. Database schema initialization relies on ad-hoc `CREATE TABLE IF NOT EXISTS` without a formal migration system.
2. Lesson Patch and Learning Path state machines are permissive, allowing duplicate IDs, concurrent state corruptions, and invalid multiple "current" nodes.
3. The AI Tutor has excessive capabilities (e.g. direct mastery modification) and lacks durable multi-turn reasoning context, execution tracing, and robust tool sandboxing.
4. There is no automated document ingestion or living knowledge compilation pipeline, meaning knowledge cannot be extracted from user documents into versioned artifacts with claim-level evidence.

## Solution

Build OpenTutor v0.3 to realize the full end-to-end AI Tutor loop:
```text
User uploads markdown document -> Knowledge Compiler compiles into Living Knowledge (Nodes, Claims, Evidence, Artifacts) -> Course Compiler generates Course Graph & dynamic Learning Path -> Socratic Tutor Agent engages learner -> Diagnoses prerequisite gap -> Inserts Detour -> Learner completes diagnostic assessment -> MasteryPolicy updates knowledge state -> Path replans & resumes.
```

The system hardens domain invariants, introduces an embedded SQLite migration runner, encapsulates typed domain tools via single-source TypeBox schemas, separates Tutor/Assessment/Compiler capabilities, implements SQLite FTS5 agentic retrieval with step budgets, and provides end-to-end golden path verification.

## User Stories

1. As a learner, I want to upload Markdown materials (e.g. CS336 Transformer notes) so that OpenTutor compiles them into structured, reusable knowledge artifacts.
2. As a learner, I want the system to recognize duplicate document uploads via SHA-256 hashing and perform incremental updates rather than re-indexing everything.
3. As a learner, I want to create a course from a learning goal (e.g. "Understand Transformer from scratch") and receive a tailored topological course graph.
4. As a learner, I want to ask questions in the Learning Room and have the AI Tutor retrieve verified claims from compiled artifacts instead of raw chunk noise.
5. As a learner, I want missing prerequisite concepts (e.g. Softmax) to be automatically inserted as a Detour before my active lesson, shifting my current node cleanly and resuming the main track once mastered.
6. As a learner, I want my quiz answers to be graded against rubrics and update my knowledge state incrementally via a confidence-based `MasteryPolicy` (rather than instantly jumping to mastered on a single lucky answer).
7. As an engineer, I want database changes to execute via sequential SQLite migrations (`schema_migrations`), ensuring reproducible database states across versions.
8. As an engineer, I want the Lesson Patch and Learning Path engines to strictly enforce invariants (rejecting duplicate IDs, non-existent targets, and illegal multi-current states).
9. As an engineer, I want all Agent tool calls, reasoning boundaries, and execution traces to be logged to `agent_runs` and `agent_tool_calls` for full observability.
10. As an engineer, I want the entire workspace to validate deterministically via `pnpm check` (typecheck + all unit & integration tests + web build).

## Implementation Decisions

### Phase 0 & 1: Domain Hardening & Invariants
- **Migration Runner**: Build `packages/database/src/migration-runner.ts` tracking applied scripts in `schema_migrations`.
- **Strict Lesson Patch**: Reject empty patches, duplicate block IDs, non-existent patch targets, ID/type mutations, and version conflicts (`VERSION_CONFLICT`).
- **Single-Current Path State Machine**: Enforce that an active session has exactly one `current` node at all times. Introduce semantic operations: `insertDetour` (inserts detour before current node, marks detour as `current` and previous as `upcoming`), `completeCurrentNode`, and `resumeMainPath`.
- **Capability Segregation**:
  - `TutorAgent`: Read-only knowledge access + lesson patching + detour insertion.
  - `AssessmentService`: Exclusive authority to evaluate answers and update mastery.
  - `KnowledgeCompiler`: Exclusive authority to upsert nodes, claims, and artifacts.
- **Single-Source Tool Schemas**: Use TypeBox / unified schema validator for tool parameter parsing, static typing, and runtime validation.
- **Atomic Domain & Event Persistence**: Enforce that domain mutations and `learning_events` logging occur within the same SQLite transaction before SSE broadcasting.

### Phase 2: Tutor Runtime & Observability
- **Runtime Abstraction**: Define `TutorRuntime` with `FakeTutorRuntime` for testing and `PiTutorRuntime` for production.
- **Session Decoupling**: Persist `agent_sessions` mapping to SQLite without storing business state inside ephemeral agent memory.
- **Tool Sandbox**: Ensure zero coding tools (`bash`, `write`, `edit`) are exposed to the Tutor session.
- **Trace Persistence**: Log every agent turn and tool invocation into `agent_runs` and `agent_tool_calls`.
- **Unified Intention Pipeline**: Route both quick actions (`simpler`, `show_code`, `visualize`) and freeform chat messages through the unified `TutorRuntime`.

### Phase 3 & 4: Living Knowledge Core & Agentic Retrieval
- **New Package `@opentutor/knowledge-core`**:
  - Source parser (Markdown / Text) with SHA-256 deduplication.
  - Pluggable `KnowledgeAnalyzer` (`FakeKnowledgeAnalyzer`, `LLMKnowledgeAnalyzer`).
  - Entity Resolver with normalized alias matching.
  - Relational schema: `documents`, `document_versions`, `document_sections`, `document_chunks`, `claims`, `claim_evidence`, `knowledge_artifacts`, `knowledge_artifact_versions`.
- **Agentic Retrieval**:
  - SQLite FTS5 index on documents, claims, and artifacts.
  - Domain tools: `knowledge_search`, `artifact_read`, `source_search`, `source_read`, `graph_neighbors`.
  - Level 0/1/2 retrieval budget limiting search hops.

### Phase 5, 6, 7 & 8: Assessment, Skills, Course Compiler & Golden Path E2E
- **MasteryPolicy**: Confidence calculation ($0.0 \sim 1.0$) mapped to status thresholds (`unknown`, `learning`, `weak`, `mastered`).
- **Course Compiler**: Goal analysis $\rightarrow$ Prerequisite closure $\rightarrow$ Topological sort $\rightarrow$ Filter mastered nodes $\rightarrow$ Learning Path.
- **Socratic Skills**: Embedded pedagogical strategies (Concept First, Code First, Intuition First).
- **Golden Path E2E**: Automated end-to-end scenario test validating Document upload $\rightarrow$ Knowledge Compile $\rightarrow$ Course Generation $\rightarrow$ Detour Diagnosis $\rightarrow$ Assessment $\rightarrow$ Path Resume $\rightarrow$ Reboot resilience.

## Testing Decisions

- **Seams**:
  - In-memory SQLite tests for every repository, migration, and domain invariant.
  - Deterministic mocks (`FakeKnowledgeAnalyzer`, `FakeTutorRuntime`) for CI test suites.
  - E2E scenario tests against the complete HTTP/SSE surface.
- **Quality Gate**: `pnpm check` running root-level typecheck, database tests, core tests, server tests, and frontend build.

## Out of Scope

- PostgreSQL / External Vector DBs / Graph DBs (SQLite FTS5 + relational graph is sufficient).
- OCR, PDF visual parsing, PPT ingestion, Audio/Video tutoring.
- Multi-user authentication and cloud sync.
