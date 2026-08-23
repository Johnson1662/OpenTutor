# LangChain Google RAG Upgrade Design

## Goal

Upgrade OpenLearner's current lightweight local RAG into a LangChain-based retrieval system backed by Google embedding models and Chroma, while keeping SQLite as the source of truth for document and chunk metadata.

## Current State

- The current RAG entrypoint lives in `backend/modules/knowledge/__init__.py`.
- The current vector layer lives in `backend/modules/knowledge/vector_store.py` and uses a custom `numpy` matrix plus JSON metadata files.
- Embeddings are not model-based; the current implementation uses a local hash embedding fallback.
- SQLite already stores `knowledge_documents` and `knowledge_chunks`, so metadata persistence is already in place.
- Course and level generation already consume retrieval output through the business-facing `Retriever`, which is a good seam for replacing internals without rewriting every generator.

## Recommended Architecture

Use LangChain for document chunking, embedding, and vector retrieval. Use Google embedding models for semantic representation and Chroma for persistent local vector storage. Keep SQLite for business metadata, course linking, and chunk bookkeeping. This gives OpenLearner a standard, extensible RAG foundation without requiring external infrastructure.

## Storage Model

The upgraded system keeps a dual-store model:

- **SQLite**
  - `knowledge_documents`
  - `knowledge_chunks`
  - course and user linkage metadata
- **Chroma**
  - vector embeddings
  - retrieval-time metadata filtering
  - local persistence directory under backend data storage

SQLite remains the business truth. Chroma becomes the semantic retrieval engine.

## Component Layout

### `backend/modules/knowledge/loaders.py`

Responsible for extracting raw text from:

- pasted text
- PDF
- DOCX
- URL

This mostly preserves the current `DocumentLoader`, but moves it into a more maintainable module layout.

### `backend/modules/knowledge/embeddings.py`

Provides a single embedding factory using Google embeddings via LangChain. It should:

- read API keys from environment
- read `GOOGLE_EMBEDDING_MODEL`
- fail loudly if configuration is invalid
- avoid silent fallback to low-quality embeddings

### `backend/modules/knowledge/splitter.py`

Wraps a LangChain text splitter and standardizes chunking configuration:

- `chunk_size`
- `chunk_overlap`
- metadata enrichment per chunk

### `backend/modules/knowledge/vector_store.py`

Reimplemented as a Chroma wrapper. It should:

- upsert chunk documents
- perform similarity search
- filter by metadata like `course_id`
- delete or clear persisted vector entries

### `backend/modules/knowledge/retriever.py`

Business-facing retrieval API that prepares prompt-ready context. It should retain the current external shape:

- `retrieve_for_course(...)`
- `retrieve_for_level(...)`

This keeps generator modules insulated from LangChain details.

## Retrieval Flow

1. Material enters through upload or parsing flow.
2. Extracted text is normalized.
3. LangChain splitter creates chunks.
4. Chunk text and metadata are stored in SQLite.
5. Chunk embeddings are stored in Chroma.
6. Retrieval builds a scoped query using title, chapter, level, and optional `course_id`.
7. Chroma returns the most relevant chunks.
8. The retriever formats those chunks into prompt-ready context for course or level generation.

## Generator Integration

### Course generation

`backend/modules/services/course_generator.py` should retrieve course-level context before outline generation so the generated chapters and levels are grounded in retrieved material rather than only raw material snippets.

### Level generation

`backend/modules/services/level_generator.py` should retrieve level-scoped context before asking Gemini for content generation. If the structured generation response is invalid, the system should fail explicitly instead of silently degrading into weak template content.

## Environment Strategy

The backend should target Python `3.11` using conda when local dependencies do not support `3.14`.

Recommended setup:

```bash
conda create -n openlearner-backend python=3.11
conda activate openlearner-backend
pip install -r backend/requirements.txt
```

If conda is not on the PATH inside the shell used by the agent, we should locate the installation or get the exact executable path before trying to create the environment.

## Configuration

Expected new environment variables:

- `GOOGLE_API_KEY` or reuse `GEMINI_API_KEY` if deliberately unified
- `GOOGLE_EMBEDDING_MODEL`
- `CHROMA_PERSIST_DIR`

The embedding model setting should be independent from the generation model setting.

## Failure Policy

- Missing embedding configuration should raise a clear error.
- Invalid embedding initialization should raise a clear error.
- Invalid AI JSON during level generation should raise a clear error.
- The system should not silently fall back to low-quality hash embeddings in the main RAG path.

## Verification Strategy

The upgrade should be verified with:

- environment/config tests
- chunking tests
- Chroma persistence tests
- ingestion tests
- retrieval tests
- course generator grounding tests
- level generator grounding tests
- API knowledge endpoint tests
- full backend suite
- `python start.py` after each code change, per repository guidance

## Why This Design

This design preserves the parts of the current RAG implementation that are already working well, especially the business-facing retrieval contract and SQLite metadata model, while replacing the weakest parts: custom embeddings and custom vector storage. It also keeps the system local-first and easy to run in development.
