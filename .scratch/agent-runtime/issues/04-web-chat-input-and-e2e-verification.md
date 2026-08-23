# 04 — Web Chat Input and Full E2E Verification

**What to build:** Enhance `apps/web` TutorPanel to support text input for direct conversation with the AI Tutor, connecting to `POST /api/sessions/:sessionId/messages` and rendering real-time streaming replies.

**Blocked by:** 03 — Server Message Endpoint and Event Streaming

**Status:** ready-for-agent

- [ ] Update `TutorPanel.tsx` in `apps/web` with message input bar and streaming message support
- [ ] Connect `apps/web/src/runtime/api.ts` `sendTutorMessage` function
- [ ] Run full workspace verification: database tests, server integration tests, typechecks, and web build
