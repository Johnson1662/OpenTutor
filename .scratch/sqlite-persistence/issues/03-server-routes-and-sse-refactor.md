# 03 — Server Routes and Durable SSE Pipeline

**What to build:** Refactor `apps/server` HTTP endpoints and SSE event streaming to route through domain services and durable SQLite event log instead of in-memory singleton variables.

**Blocked by:** 02 — Domain Repositories and Services

**Status:** ready-for-agent

- [ ] Refactor `apps/server/src/index.ts` and `apps/server/src/api/routes.ts` to dispatch HTTP actions to `SessionService`, `LessonService`, and `KnowledgeService`
- [ ] Refactor SSE endpoint `GET /api/sessions/:sessionId/events` to support `Last-Event-ID` header and replay missed events from `learning_events`
- [ ] Connect `EventBus` to publish all mutations to connected SSE streams
- [ ] Implement `POST /api/sessions/:sessionId/actions` (simpler, show_code, visualize, softmax_unknown) executing service workflows
- [ ] Implement `POST /api/lessons/:lessonId/blocks/:blockId/answer` executing diagnostic evaluation and state updates
