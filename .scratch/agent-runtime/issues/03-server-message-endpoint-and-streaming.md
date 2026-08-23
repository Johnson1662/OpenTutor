# 03 — Server Message Endpoint and Event Streaming

**What to build:** Integrate `@opentutor/agent-runtime` and `@opentutor/agent-tools` into `apps/server`, adding `POST /api/sessions/:sessionId/messages` to stream LLM responses and broadcast dynamic tool patches over SSE.

**Blocked by:** 02 — Agent Runtime Package (@opentutor/agent-runtime)

**Status:** ready-for-agent

- [ ] Update `@opentutor/server` to initialize `TutorAgent` with domain services and `EventBus`
- [ ] Add `POST /api/sessions/:sessionId/messages` endpoint receiving learner natural language input
- [ ] Stream `agent.text.delta` events and tool patch events over SSE
- [ ] Write integration test verifying full message-to-patch pipeline in `apps/server/tests`
