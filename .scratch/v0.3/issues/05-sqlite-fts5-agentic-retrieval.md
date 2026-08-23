# 05 — SQLite FTS5 Agentic Retrieval Tools and Search Budgets

**What to build:** Implement SQLite FTS5 indexing across Knowledge Artifacts and Document Chunks, and build retrieval tools (`knowledge_search`, `artifact_read`, `source_search`, `source_read`, `graph_neighbors`) with Level 0/1/2 search budget limits.

**Blocked by:** 04 — Knowledge Core Package and Living Knowledge Compiler

**Status:** ready-for-agent

- [ ] Add SQLite FTS5 virtual tables for artifacts and chunks in `packages/knowledge-core`
- [ ] Implement retrieval tools: `knowledge_search`, `artifact_read`, `source_search`, `source_read`, `graph_neighbors`
- [ ] Implement search step budget manager preventing infinite recursive searches
- [ ] Write integration test verifying level 1 vs level 2 retrieval flows
