# 04 — E2E Integration, Verification, and Frontend Compatibility

**What to build:** End-to-end integration between `apps/web` and the SQLite-backed `apps/server`, verifying that full Learning Room interactions (initial snapshot load, lesson patching, detour insertion, quiz submission, server reboot persistence) work reliably without regression.

**Blocked by:** 03 — Server Routes and Durable SSE Pipeline

**Status:** ready-for-agent

- [ ] Ensure web client (`apps/web`) seamlessly talks to the refactored server endpoints
- [ ] Write end-to-end integration test exercising:
  1. Boot server with SQLite database
  2. Query initial session snapshot
  3. Apply lesson patch and verify DB version increment
  4. Submit quiz answer and verify assessment & user knowledge state persistence
  5. Restart server instance (reconnecting to same SQLite DB file) and verify full state restoration
- [ ] Run full typecheck and build across workspace (`pnpm build` & `pnpm typecheck:server`)
