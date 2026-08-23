# OpenTutor Learning Room Prototype — Server + SSE

This iteration replaces the local mock runtime with a server-authoritative Learning Session and an SSE event stream.

## What is implemented

- TypeScript monorepo protocol package
- React Learning Room
- Native Node.js TypeScript prototype server
- Session snapshot endpoint
- SSE stream with ordered `seq` events and reconnect replay buffer
- `agent.started` / `agent.completed`
- `lesson.patch` with base/version checks on the client
- `path.patch` with path versioning
- server-side Tutor mock actions: Simpler / Show code / Visualize / Softmax detour
- quiz submission through HTTP
- `assessment.completed` → `path.patch` → `lesson.updated` → `knowledge.updated`
- server state is authoritative; client refreshes snapshot on version mismatch

## Run

Requirements: Node.js 22+, pnpm.

```bash
pnpm install
pnpm dev
```

- Web: Vite default (`http://localhost:5173`)
- Server: `http://localhost:8787`
- Vite proxies `/api` to the server, including SSE.

The server intentionally uses Node 22's `--experimental-strip-types` so this prototype does not need a server framework or TS runtime dependency.

## Key API

```text
GET  /api/sessions/prototype
GET  /api/sessions/prototype/events
POST /api/sessions/prototype/actions
POST /api/lessons/:lessonId/blocks/:blockId/answer
POST /api/sessions/prototype/reset
```

## Next step

Replace the server's `tutorResult()` mock decision function with Pi SDK + typed OpenTutor domain tools. The Web/SSE/Protocol flow should remain unchanged.
