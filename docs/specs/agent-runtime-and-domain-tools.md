# Spec: Agent Runtime and Domain Tools

## Problem Statement

Currently, the AI Tutor interactions in OpenTutor are triggered by pre-configured button actions with hardcoded patch templates. Learners cannot freely converse with the AI Tutor using natural language, nor can the AI dynamically reason about the learner's specific doubts, generate bespoke code/diagram blocks, or intelligently diagnose prerequisite gaps.

## Solution

Build `packages/agent-tools` and `packages/agent-runtime` to empower the AI Tutor with LLM-driven reasoning. Enforce strict safety boundaries: disable all default OS/file tools and expose only typed OpenTutor Domain Tools (`lesson_patch`, `path_patch`, `assessment_record`, `knowledge_get`, `lesson_get`). Connect the runtime to `apps/server` so that natural language learner queries are handled by the agent, streaming real-time explanations and applying versioned lesson/path mutations to the SQLite database and Web UI.

## User Stories

1. As a learner, I want to type natural language questions into the AI Tutor panel, so that I can ask for clarification on any concept in the lesson.
2. As a learner, I want the AI Tutor to dynamically insert custom code blocks or diagrams into my lesson canvas, so that I get an explanation tailored to my preferred learning style.
3. As a learner, I want the AI Tutor to diagnose missing prerequisite knowledge from my queries and automatically insert Detour nodes into my Learning Path, so that I can fill knowledge gaps without losing my main study route.
4. As a learner, I want the AI Tutor's text explanations to stream smoothly into the conversation panel, so that I receive immediate feedback without long waiting times.
5. As a system architect, I want the AI Tutor to be strictly constrained to typed Domain Tools, so that the LLM cannot execute arbitrary shell commands, touch the filesystem, or execute raw SQL queries.
6. As a system architect, I want every tool invocation to validate against optimistic concurrency versions (`baseVersion`), so that the LLM cannot overwrite concurrent user interactions.

## Implementation Decisions

- **Domain Tools Package (`packages/agent-tools`)**:
  - Export typed schemas and JSON-Schema definitions for:
    - `lesson_get`: Retrieve current lesson blocks and version.
    - `lesson_patch`: Apply structured block mutations (`insert`, `replace`, `update`, `remove`, `move`).
    - `path_get`: Retrieve active learning path and current node.
    - `path_patch`: Apply path node mutations (insert `detour`, update status).
    - `assessment_record`: Record diagnostic feedback and update mastery.
    - `knowledge_get`: Retrieve canonical description and metadata of a knowledge node.
  - Implement `createDomainTools(services)` mapping schema calls directly to Domain Services.
- **Agent Runtime Package (`packages/agent-runtime`)**:
  - Implement `TutorAgent` supporting LLM-driven tool calling with conversational memory.
  - Support configurable LLM providers (OpenAI-compatible, DeepSeek, Gemini, Anthropic) via standard environment variables (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`).
  - Provide a deterministic, testable runtime with fallback for hermetic unit and integration testing.
  - Inject the Socratic Tutor system prompt embedding pedagogical principles (Alvar method: adaptive visuals, minimal chat bloat, canvas-first teaching).
- **Server API Extension**:
  - Implement `POST /api/sessions/:sessionId/messages` accepting `{ message: string }`.
  - Stream events over SSE: `agent.started`, `agent.text.delta`, `agent.completed`, alongside tool-driven `lesson.patch` and `path.patch`.
- **Frontend Integration (`apps/web`)**:
  - Update `TutorPanel` to support custom text message submission alongside quick-action chips.

## Testing Decisions

- **Testing Seams**:
  - Unit tests in `packages/agent-tools` verifying tool schema validation and safe execution against mock domain services.
  - Unit tests in `packages/agent-runtime` verifying tool dispatching and event generation.
  - Integration tests in `apps/server` verifying end-to-end `POST /api/sessions/:sessionId/messages` flows with tool execution, SQLite updates, and SSE broadcasts.
- **Behavioral Focus**:
  - Verify that LLM tool calls with invalid arguments are rejected cleanly.
  - Verify that version conflicts in tool calls trigger proper error feedback to the agent.
  - Verify that the agent correctly updates the active lesson and broadcasts patches over SSE.

## Out of Scope

- Multi-agent collaboration or autonomous background agents (TDD v1.0 specifies single Tutor AgentSession for MVP).
- Full document compilation / PDF parsing (Phase 6).
