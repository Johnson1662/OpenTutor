# Backend RAG Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move OpenLearner business data and generation orchestration into the backend, add real RAG retrieval, and make chapter and level generation granular enough to support stronger learning outcomes.

**Architecture:** FastAPI becomes the single business backend. SQLite, uploaded materials, level caches, user data, and retrieval indexes live under `backend`. The frontend only renders UI and talks to FastAPI through `src/lib/api.ts`. RAG v1 uses the local persistent vector store and a replaceable embedding layer.

**Tech Stack:** FastAPI, SQLite, numpy vector store, Python 3.11 via conda, Next.js, TypeScript, pytest

---

### Task 1: Backend runtime baseline and setup docs

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`
- Modify: `AGENTS.md` or project docs if needed

**Step 1: Write the failing test**

Add a documentation-oriented backend test in `backend/tests/test_environment_baseline.py` that asserts the project documents Python `3.11` as the preferred backend runtime.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_environment_baseline.py -v`
Expected: FAIL because the baseline is not yet documented.

**Step 3: Write minimal implementation**

Update docs and environment examples to state:

```text
Preferred backend runtime: Python 3.11
Recommended setup: conda create -n openlearner-backend python=3.11
```

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_environment_baseline.py -v`
Expected: PASS

**Step 5: Verify startup path**

Run: `python start.py`
Expected: Startup succeeds, or reports only external-secret blockers such as missing Gemini credentials.

### Task 2: Add normalized backend schema

**Files:**
- Modify: `backend/modules/database/__init__.py`
- Create: `backend/tests/test_database_schema.py`

**Step 1: Write the failing test**

Create a test that asserts all required tables exist:

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

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_database_schema.py -v`
Expected: FAIL because the current schema is incomplete.

**Step 3: Write minimal implementation**

Expand backend DB initialization so all required tables and key indexes are created.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_database_schema.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Startup reaches backend initialization without schema errors.

### Task 3: Replace JSON blob course persistence with normalized reads and writes

**Files:**
- Modify: `backend/modules/database/__init__.py`
- Create: `backend/tests/test_database_course_roundtrip.py`

**Step 1: Write the failing test**

Create a roundtrip test that saves a course, chapters, levels, and course material, then reads them back in frontend-compatible shape.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_database_course_roundtrip.py -v`
Expected: FAIL because current storage still depends on `course_details` JSON.

**Step 3: Write minimal implementation**

Implement normalized save and read methods for:

- `save_course`
- `get_course_with_details`
- `get_all_courses`
- `save_course_material`
- `get_course_material`
- `save_level_content`
- `get_level_content`
- `clear_all_generated_level_content`

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_database_course_roundtrip.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Backend starts without persistence-layer regressions.

### Task 4: Add backend user, progress, and study persistence

**Files:**
- Modify: `backend/modules/database/__init__.py`
- Create: `backend/tests/test_database_user_progress.py`

**Step 1: Write the failing test**

Cover these methods:

- `get_or_create_user`
- `update_user_progress`
- `update_level_status`
- `get_user_progress`
- `record_study_session`
- `has_studied_today`
- `get_study_stats`
- `save_user_answer`
- `save_user_feedback`

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_database_user_progress.py -v`
Expected: FAIL because the backend does not yet expose full equivalents.

**Step 3: Write minimal implementation**

Add the missing methods and keep response data compatible with current frontend expectations.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_database_user_progress.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Startup succeeds apart from explicit external-secret blockers.

### Task 5: Implement real RAG ingestion and retrieval

**Files:**
- Modify: `backend/modules/knowledge/__init__.py`
- Modify: `backend/modules/knowledge/vector_store.py`
- Create: `backend/tests/test_rag_ingestion.py`
- Create: `backend/tests/test_rag_retrieval.py`

**Step 1: Write the failing tests**

Add tests proving that:

- uploaded content is chunked and stored
- chunk metadata is persisted
- vector retrieval returns real content
- retrieval supports metadata scoping such as `course_id`

**Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_rag_ingestion.py backend/tests/test_rag_retrieval.py -v`
Expected: FAIL because retrieval is currently placeholder text.

**Step 3: Write minimal implementation**

Replace the in-memory-only knowledge path with database-backed document registration and vector ingestion. Replace placeholder retriever outputs with actual similarity retrieval and prompt-ready context assembly.

**Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_rag_ingestion.py backend/tests/test_rag_retrieval.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Knowledge upload and retrieval paths initialize correctly.

### Task 6: Make course generation more granular and RAG-aware

**Files:**
- Modify: `backend/modules/services/course_generator.py`
- Create: `backend/tests/test_course_generator_outline.py`

**Step 1: Write the failing test**

Add a test that asserts generated output is structured around narrower knowledge units and produces more granular levels than the current broad template.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_course_generator_outline.py -v`
Expected: FAIL because current outline generation is still broad.

**Step 3: Write minimal implementation**

Refactor prompt construction and template fallback so chapters are theme-level and levels are knowledge-point or ability-point level, using retrieved context instead of only raw material snippets.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_course_generator_outline.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Course generation remains callable.

### Task 7: Make level generation a mastery loop

**Files:**
- Modify: `backend/modules/services/level_generator.py`
- Create: `backend/tests/test_level_generator_granularity.py`

**Step 1: Write the failing test**

Add a test requiring that level generation includes a richer mastery loop with explanation, contrast, worked example, and multiple practice or diagnosis steps.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_level_generator_granularity.py -v`
Expected: FAIL because the current generator usually outputs only a few steps.

**Step 3: Write minimal implementation**

Update prompt design, normalization, and template fallback to produce richer, grounded level steps while preserving frontend compatibility.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_level_generator_granularity.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Level generation path initializes and existing frontend rendering still works.

### Task 8: Consolidate business APIs into FastAPI

**Files:**
- Modify: `backend/api/main.py`
- Create: `backend/tests/test_api_course_endpoints.py`
- Create: `backend/tests/test_api_user_progress_endpoints.py`

**Step 1: Write the failing tests**

Cover:

- `GET /api/courses`
- `GET /api/courses/{course_id}`
- `POST /api/courses`
- `DELETE /api/courses/{course_id}`
- `GET /api/user`
- `GET/POST /api/progress`
- `GET/POST /api/study`

**Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_api_course_endpoints.py backend/tests/test_api_user_progress_endpoints.py -v`
Expected: FAIL because the backend surface is incomplete and inconsistent.

**Step 3: Write minimal implementation**

Implement or normalize these endpoints in FastAPI using the backend DB layer as the only persistence path.

**Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_api_course_endpoints.py backend/tests/test_api_user_progress_endpoints.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Backend routes load without import or runtime errors.

### Task 9: Switch frontend API client to backend-only business calls

**Files:**
- Modify: `src/lib/api.ts`

**Step 1: Write the failing test**

If practical, add a lightweight API-shape regression test or compile-time check ensuring the frontend consumes FastAPI responses rather than Next local route responses.

**Step 2: Run verification to confirm current mismatch**

Run: `npm run build`
Expected: Existing build or type assumptions reveal required adaptation points.

**Step 3: Write minimal implementation**

Update client calls for:

- `fetchUserData`
- `saveCourseApi`
- `recordStudySession`
- `fetchStudyStats`
- `checkTodayStudy`
- `updateProgress`
- `fetchProgress`

Convert backend payloads inside `src/lib/api.ts` so components stay simple.

**Step 4: Run verification**

Run: `npm run build`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Main frontend flows can talk to backend-only APIs.

### Task 10: Retire frontend-local DB main path

**Files:**
- Modify: `src/app/api/courses/route.ts`
- Modify: `src/app/api/progress/route.ts`
- Modify: `src/app/api/study/route.ts`
- Modify: `src/app/api/user/route.ts`
- Modify: `src/lib/db/memory-db.ts`
- Modify: `src/lib/db/sqlite.ts`

**Step 1: Write the failing test**

Add a regression assertion or static check confirming the main app path no longer depends on frontend-local DB helpers.

**Step 2: Run verification to confirm current dependency**

Run: `npm run build`
Expected: Existing references still show the local DB path is active.

**Step 3: Write minimal implementation**

Deprecate Next routes into thin proxies or mark them unused. Remove frontend-local DB from the main runtime path without destructively deleting useful fallback code too early.

**Step 4: Run verification**

Run: `npm run build`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Main flows still work after route retirement.

### Task 11: Add migration scripts for legacy data

**Files:**
- Create: `backend/scripts/migrate_frontend_sqlite_to_backend.py`
- Create: `backend/scripts/migrate_legacy_backend_json_courses.py`
- Create: `backend/tests/test_migration_scripts.py`

**Step 1: Write the failing test**

Create fixture-driven migration tests that prove course, chapter, level, material, user progress, and study data migrate correctly.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_migration_scripts.py -v`
Expected: FAIL because scripts do not yet exist.

**Step 3: Write minimal implementation**

Implement one script for the legacy frontend SQLite database and one script for old backend JSON blob courses.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_migration_scripts.py -v`
Expected: PASS

**Step 5: Verify startup**

Run: `python start.py`
Expected: Migrated backend data remains readable.

### Task 12: Full verification

**Files:**
- Verify only

**Step 1: Run backend test suite**

Run: `pytest backend/tests -v`
Expected: PASS

**Step 2: Run frontend build**

Run: `npm run build`
Expected: PASS

**Step 3: Run integrated startup check**

Run: `python start.py`
Expected: PASS, or explicit environment-secret blocker only.

**Step 4: Manual regression checklist**

Verify:

- course creation
- course detail loading
- level generation
- progress updates
- study stats
- knowledge upload and search

**Step 5: Prepare for branch finishing**

After all work and verification succeed, use `superpowers:finishing-a-development-branch`.
