# LangChain Google RAG Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current custom hash-embedding RAG with a LangChain-based Google Embeddings + Chroma pipeline while preserving SQLite metadata and existing course/level generator entrypoints.

**Architecture:** SQLite continues to store document and chunk metadata. LangChain manages text splitting, embedding, and Chroma vector persistence. Business modules still call a stable `Retriever` API, so generator code stays decoupled from LangChain internals.

**Tech Stack:** Python 3.11 via conda, FastAPI, LangChain, langchain-google-genai, langchain-chroma, chromadb, SQLite, Gemini/Google API

---

### Task 1: Environment baseline and dependency setup

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`
- Modify: `AGENTS.md`
- Test: `backend/tests/test_environment_baseline.py`

**Step 1: Write the failing test**

Extend `backend/tests/test_environment_baseline.py` so it asserts the docs and env examples include:

- Python `3.11`
- conda setup guidance
- Google embedding model configuration
- Chroma persistence configuration

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_environment_baseline.py -v`
Expected: FAIL because the new RAG-related configuration is not documented yet.

**Step 3: Write minimal implementation**

Update:

- `backend/requirements.txt`
- `backend/.env.example`
- `AGENTS.md`

Add the LangChain and Chroma dependencies and environment variables.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_environment_baseline.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Application still starts, or shows only explicit configuration blockers.

### Task 2: Google embedding provider wrapper

**Files:**
- Create: `backend/modules/knowledge/embeddings.py`
- Test: `backend/tests/test_google_embeddings_config.py`

**Step 1: Write the failing test**

Create `backend/tests/test_google_embeddings_config.py` to assert:

- missing key raises a clear error
- default model name is set
- explicit embedding model env var overrides the default

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_google_embeddings_config.py -v`
Expected: FAIL because the module does not exist.

**Step 3: Write minimal implementation**

Implement `get_embedding_model()` in `backend/modules/knowledge/embeddings.py` using LangChain's Google embedding integration.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_google_embeddings_config.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: App startup remains valid when embedding initialization is lazy.

### Task 3: LangChain splitter integration

**Files:**
- Create: `backend/modules/knowledge/splitter.py`
- Test: `backend/tests/test_rag_chunking.py`

**Step 1: Write the failing test**

Add `backend/tests/test_rag_chunking.py` to assert:

- long text splits into multiple chunks
- overlap is preserved
- chunk metadata includes ordering information

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_rag_chunking.py -v`
Expected: FAIL because no splitter module exists yet.

**Step 3: Write minimal implementation**

Implement a LangChain text splitter wrapper with stable defaults.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_rag_chunking.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: No import or startup regressions.

### Task 4: Chroma vector store wrapper

**Files:**
- Modify: `backend/modules/knowledge/vector_store.py`
- Test: `backend/tests/test_chroma_vector_store.py`

**Step 1: Write the failing test**

Create `backend/tests/test_chroma_vector_store.py` to assert:

- vectors can be persisted
- vectors survive reload
- metadata filter works by `course_id`
- documents can be deleted cleanly

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_chroma_vector_store.py -v`
Expected: FAIL because the current vector store is not Chroma-based.

**Step 3: Write minimal implementation**

Replace the current custom `numpy` implementation with a Chroma-backed wrapper that preserves the project-facing API.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_chroma_vector_store.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Chroma persistence directory is created and app startup remains healthy.

### Task 5: Knowledge base dual-write integration

**Files:**
- Modify: `backend/modules/knowledge/__init__.py`
- Test: `backend/tests/test_rag_ingestion.py`

**Step 1: Write the failing test**

Update `backend/tests/test_rag_ingestion.py` to assert ingestion writes both:

- SQLite metadata rows
- Chroma vector records

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_rag_ingestion.py -v`
Expected: FAIL because ingestion still depends on the old vector layer.

**Step 3: Write minimal implementation**

Refactor `PersistentKnowledgeBase.add_documents(...)` so it:

- registers documents
- splits text via LangChain splitter
- writes chunk metadata to SQLite
- writes vectors to Chroma

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_rag_ingestion.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Material ingestion remains available.

### Task 6: Retriever upgrade on top of Chroma

**Files:**
- Modify: `backend/modules/knowledge/__init__.py`
- Create: `backend/modules/knowledge/retriever.py`
- Test: `backend/tests/test_rag_retrieval.py`

**Step 1: Write the failing test**

Update `backend/tests/test_rag_retrieval.py` to assert:

- course retrieval returns relevant grounded chunks
- level retrieval respects `course_id` scoping
- formatted context is suitable for prompt injection

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_rag_retrieval.py -v`
Expected: FAIL because retrieval still depends on the old store behavior.

**Step 3: Write minimal implementation**

Move retrieval logic into a dedicated module and make it read from Chroma-backed similarity search.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_rag_retrieval.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Retrieval remains available for generators.

### Task 7: Course generator grounding upgrade

**Files:**
- Modify: `backend/modules/services/course_generator.py`
- Test: `backend/tests/test_course_generator_outline.py`

**Step 1: Write the failing test**

Extend the course outline test so it verifies generated output reflects retrieved material context, not just raw input text.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_course_generator_outline.py -v`
Expected: FAIL or partial failure.

**Step 3: Write minimal implementation**

Integrate `retrieve_for_course(...)` into the course generator prompt assembly.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_course_generator_outline.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Course generation remains functional.

### Task 8: Level generator grounding upgrade

**Files:**
- Modify: `backend/modules/services/level_generator.py`
- Test: `backend/tests/test_level_generator_granularity.py`
- Test: `backend/tests/test_level_generation_quality.py`

**Step 1: Write the failing test**

Expand the level generator tests so they verify:

- level retrieval is used
- generation remains structured
- invalid AI JSON fails loudly rather than degrading silently

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_level_generator_granularity.py backend/tests/test_level_generation_quality.py -v`
Expected: FAIL or partial failure.

**Step 3: Write minimal implementation**

Integrate `retrieve_for_level(...)` into the level generation path while preserving explicit failure behavior for invalid JSON output.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_level_generator_granularity.py backend/tests/test_level_generation_quality.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Level generation remains callable.

### Task 9: Knowledge API verification

**Files:**
- Modify: `backend/api/main.py`
- Create: `backend/tests/test_api_knowledge_endpoints.py`

**Step 1: Write the failing test**

Add API tests covering:

- ingesting knowledge material
- searching by `course_id`
- returning grounded text snippets

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_api_knowledge_endpoints.py -v`
Expected: FAIL because the API is not yet aligned with the upgraded retrieval pipeline.

**Step 3: Write minimal implementation**

Adapt knowledge-related API behavior to use the new LangChain + Chroma-backed knowledge base.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_api_knowledge_endpoints.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Knowledge APIs remain functional.

### Task 10: Remove silent hash-embedding fallback from the main path

**Files:**
- Modify: `backend/modules/knowledge/vector_store.py`
- Modify: `backend/modules/knowledge/embeddings.py`
- Test: `backend/tests/test_google_embeddings_config.py`

**Step 1: Write the failing test**

Add an assertion that missing embedding configuration causes an explicit failure rather than silently using low-quality embeddings.

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_google_embeddings_config.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Remove silent fallback behavior from the primary RAG path.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_google_embeddings_config.py -v`
Expected: PASS

**Step 5: Run startup verification**

Run: `python start.py`
Expected: Failures remain explicit and diagnosable only when embedding functionality is invoked or eagerly initialized by design.

### Task 11: Full verification

**Files:**
- Verify only

**Step 1: Run backend suite**

Run: `pytest backend/tests -v`
Expected: PASS

**Step 2: Run frontend build**

Run: `npm run build`
Expected: PASS

**Step 3: Run integrated startup**

Run: `python start.py`
Expected: PASS

**Step 4: Manual smoke checks**

Verify:

- upload or parse material
- ingest into knowledge base
- create course from material
- generate level from material
- restart app and verify retrieval still works from Chroma persistence

**Step 5: Prepare branch finishing**

After all tasks pass, use `superpowers:finishing-a-development-branch`.
