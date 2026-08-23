# 04 — Knowledge Core Package and Living Knowledge Compiler

**What to build:** Create `packages/knowledge-core` to compile Markdown documents into Living Knowledge: Document/Sections/Chunks, Knowledge Nodes, Claims with Chunk Evidence, and versioned Knowledge Artifacts.

**Blocked by:** 03 — Tutor Runtime Abstraction, Session Decoupling, and Observability

**Status:** ready-for-agent

- [ ] Create `packages/knowledge-core` with SQLite migration for living knowledge tables (`documents`, `document_chunks`, `knowledge_node_aliases`, `claims`, `claim_evidence`, `knowledge_artifacts`)
- [ ] Implement Markdown Parser with SHA-256 deduplication (NOOP on existing content hash)
- [ ] Implement `KnowledgeAnalyzer` interface with `FakeKnowledgeAnalyzer` and `LLMKnowledgeAnalyzer`
- [ ] Implement `EntityResolver` matching canonical titles, aliases, and exact terms
- [ ] Implement `ArtifactCompiler` linking Claims to Chunk Evidence and building structured Artifacts
- [ ] Write integration test verifying incremental compilation of multi-source materials
