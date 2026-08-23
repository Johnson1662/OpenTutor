# OpenLearner Backend RAG Migration Design

## Goal

Unify OpenLearner's data and generation pipeline under the FastAPI backend, add a real retrieval-augmented generation flow for course and level generation, and make level generation granular enough to support full knowledge mastery.

## Current State

- The frontend still owns important business data through `src/lib/db/sqlite.ts` and `src/lib/db/memory-db.ts`.
- The backend has a separate SQLite layer in `backend/modules/database/__init__.py`, but it stores chapters and levels as JSON blobs in `course_details`.
- The backend already contains a lightweight persistent vector store in `backend/modules/knowledge/vector_store.py`, but `backend/modules/knowledge/__init__.py` still uses placeholder retrieval.
- Course generation in `backend/modules/services/course_generator.py` and level generation in `backend/modules/services/level_generator.py` are both too coarse for the desired learning outcomes.

## Architecture

FastAPI becomes the single business backend. SQLite, uploaded materials, level caches, user progress, and RAG indexing all live under `backend`. The frontend becomes a thin client that renders UI and calls backend APIs through `src/lib/api.ts`. RAG v1 uses a local persistent vector store with replaceable embedding logic, avoiding heavy infrastructure while keeping the retrieval layer upgradeable.

## Backend Data Model

The backend will own the following tables:

- `courses`
- `chapters`
- `levels`
- `course_materials`
- `level_content_cache`
- `users`
- `user_progress`
- `study_records`
- `user_answers`
- `user_feedback`
- `course_requirements`
- `knowledge_documents`
- `knowledge_chunks`

The old `course_details` JSON blob model is retired from the main flow. Core queryable fields move into normalized tables. JSON columns remain acceptable only for truly nested metadata such as retrieval metadata or cached generation diagnostics.

## RAG Design

RAG is split into four layers:

1. `Document ingestion`
   - Parse text, PDF, and URL inputs.
   - Normalize and split content into chunks.
   - Persist document and chunk metadata in SQLite.
   - Persist vectors through the existing local `VectorStore`.
2. `Retrieval`
   - Retrieve course-wide context for outline generation.
   - Retrieve chapter and level specific context for level generation.
   - Support metadata filtering by `course_id`, source type, and optional user scope.
3. `Context assembly`
   - Convert top results into structured prompt context including definitions, key ideas, misconceptions, examples, and prerequisite relationships.
4. `Generation`
   - Course generation uses global material structure and topic coverage.
   - Level generation uses narrower ability-point context with stronger grounding.

RAG v1 intentionally stays local and lightweight. Embedding logic remains swappable so the project can later adopt better models or external vector backends without changing application behavior.

## Granular Learning Model

The system should optimize for mastery rather than broad, shallow levels.

- Each chapter should contain roughly `4-8` levels instead of the current broad `2-4` pattern.
- Each level should map to one specific knowledge point or ability point.
- Each level should contain a mastery loop instead of a short explanation plus one quiz.

Recommended level step structure:

1. concept introduction
2. core explanation
3. misconception or contrast
4. worked example
5. basic practice
6. transfer practice
7. recap
8. diagnostic check

This gives the generation system enough room to help users understand, discriminate, apply, and verify each knowledge point.

## API Consolidation

The backend will own the main business APIs:

- `GET/POST /api/courses`
- `GET/DELETE /api/courses/{course_id}`
- `GET/POST /api/progress`
- `GET/POST /api/study`
- `GET /api/user`
- `POST /api/knowledge/upload`
- `GET /api/knowledge/search`
- existing `ai/generate-course`
- existing `ai/generate-level`

The Next.js route handlers become deprecated adapters during migration and are later removed from the main path once the frontend has fully switched over.

## Migration Strategy

Migration happens in controlled phases:

1. Add normalized backend schema and matching data-access methods.
2. Move user, progress, study, and course persistence to backend APIs.
3. Replace placeholder retrieval with real ingestion and retrieval.
4. Improve course and level generation to use RAG and finer level granularity.
5. Migrate existing frontend SQLite data and legacy backend JSON course data with scripts.
6. Retire frontend-local DB usage from the main application flow.

## Environment Strategy

The backend runtime baseline is Python `3.11`. If current machine defaults or some libraries do not support Python `3.14`, the backend should run inside a conda environment:

```bash
conda create -n openlearner-backend python=3.11
conda activate openlearner-backend
pip install -r backend/requirements.txt
```

This baseline should be reflected in docs and setup guidance.

## Verification Strategy

Verification must include:

- backend schema tests
- backend API tests
- RAG ingestion and retrieval tests
- course and level generator behavior tests
- migration script tests
- `python start.py` after each code change, per repository guidance

If local startup requires missing secrets such as Gemini API keys, that failure should be reported explicitly and treated as an environment blocker rather than silently ignored.
