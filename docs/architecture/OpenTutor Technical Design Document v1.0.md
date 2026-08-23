# OpenTutor Technical Design Document v1.0

**版本：** v1.0  
**原则：** Web First / TypeScript First / Protocol First

---

# 1. 技术目标

OpenTutor 技术架构必须同时满足：

1. Agent Runtime 可替换
2. Web 与未来 HarmonyOS 共用核心协议
3. AI 无权直接修改数据库或 DOM
4. Lesson 可以实时局部变化
5. 知识必须有来源追踪
6. Course / Knowledge / User State 解耦
7. Agent Session 丢失后业务状态仍可恢复
8. 文档知识能够增量更新

---

# 2. 总体架构

```text
                         OpenTutor

┌─────────────────────────────────────────────────┐
│                    Client                       │
│                                                 │
│ React Web                                       │
│ Lesson Renderer / Course Map / Tutor            │
└──────────────────────┬──────────────────────────┘
                       │ HTTP + SSE
┌──────────────────────▼──────────────────────────┐
│                  Server                         │
│                                                 │
│ Course Service                                  │
│ Learning Service                                │
│ Lesson Service                                  │
│ Knowledge Service                               │
│ Document Service                                │
│ Assessment Service                              │
└───────────────┬───────────────────┬─────────────┘
                │                   │
                ▼                   ▼
       Agent Runtime         Knowledge Compiler
            Pi                      Worker
                │                   │
                └─────────┬─────────┘
                          ▼
                     PostgreSQL
                   + FTS + pgvector
```

---

# 3. 技术栈

## Language

```text
TypeScript
```

作为全栈主语言。

原因：

- Web
- Server
- Protocol
- Agent Tools
- Pi SDK
- 与 ArkTS 思维模型接近

统一类型系统能够减少跨语言 DTO 和状态同步成本。

---

## Web

```text
React + TypeScript
```

建议保持 SPA / Client Renderer 属性，不将业务绑定于特定 SSR Framework。

Web 的责任：

```text
Protocol
→ State
→ Renderer
```

而不是包含 Learning Domain 逻辑。

---

## Server

```text
Node.js + TypeScript
```

负责：

- HTTP API
- SSE
- Agent Runtime
- Domain Services
- Worker 调度

具体 HTTP Framework 不属于核心架构，可独立选择。

---

## Database

```text
PostgreSQL
+
PostgreSQL Full Text Search
+
pgvector
```

MVP 不引入：

- Neo4j
- Elasticsearch
- 独立 Vector DB

知识图谱先采用 relational edge tables。

---

# 4. Pi SDK

OpenTutor 将 Pi 用作 **Agent Runtime**，而不是应用框架。

当前 Pi SDK 支持程序化创建 `AgentSession`、订阅事件、自定义 Web/mobile UI、自定义工具，以及通过 `noTools: "builtin"` 禁止默认 coding tools，因此适合构建受领域工具约束的 Tutor Runtime。

结构：

```text
OpenTutor
   ↓
Tutor Runtime
   ↓
Pi AgentSession
   ↓
Skills
+
OpenTutor Tools
   ↓
LLM
```

---

# 5. Agent Runtime v1

MVP 不部署多个自治 Agent。

采用：

```text
1 Tutor AgentSession
+
Skills
+
Domain Tools
```

Skills：

```text
teach
probe
learn-profile
learn-visual
learn-verify
```

原因：

- 共享上下文
- 减少重复 token
- 避免 Agent 间状态同步
- Learning Workflow 本身已经足够明确

后续只有明确需要上下文隔离时，再增加 worker/sub-agent。

---

# 6. Pi 安全边界

Tutor Runtime 必须关闭默认 Coding Tools：

```text
bash
write
edit
```

只开放 OpenTutor Domain Tools。

Pi SDK 当前支持保留 custom/extension tools 同时禁用 builtin tools。

目标：

```text
LLM
 ↓
Typed Tool
 ↓
Application Service
 ↓
Domain
 ↓
Database
```

禁止：

```text
LLM → SQL
LLM → filesystem
LLM → DOM
LLM → arbitrary JS
```

---

# 7. Monorepo

```text
opentutor/

├── apps/
│   ├── web/
│   └── server/
│
├── packages/
│   ├── protocol/
│   ├── learning-core/
│   ├── knowledge-core/
│   ├── database/
│   ├── agent-runtime/
│   ├── agent-tools/
│   └── learning-skills/
│
└── ...
```

建议使用 pnpm workspace。

---

# 8. Package 依赖方向

严格单向：

```text
protocol
   ↑
learning-core / knowledge-core
   ↑
database / services
   ↑
agent-tools
   ↑
agent-runtime
   ↑
server
```

Web：

```text
web → protocol
```

禁止：

```text
protocol → server
core → Pi
database → agent-runtime
web → database
```

---

# 9. Protocol Package

`packages/protocol` 是未来最稳定的一层。

```text
protocol/
├── course.ts
├── knowledge.ts
├── lesson.ts
├── patch.ts
├── assessment.ts
├── events.ts
└── api.ts
```

未来：

```text
Web
Server
HarmonyOS
```

都围绕同一语义协议。

---

# 10. Knowledge Domain

知识本体和用户掌握状态必须分离。

## knowledge_nodes

```text
id
canonical_name
description
type
metadata
created_at
updated_at
```

代表：

> Self Attention 是一个什么知识实体。

---

## knowledge_edges

```text
id
from_node_id
to_node_id
relation
weight
metadata
```

关系：

```text
requires
part_of
extends
related_to
contrasts_with
implements
example_of
```

---

## user_knowledge_states

```text
user_id
knowledge_node_id

status
confidence

last_studied_at
last_assessed_at

metadata
updated_at
```

唯一键：

```text
(user_id, knowledge_node_id)
```

状态：

```text
unknown
learning
weak
mastered
```

---

# 11. Course Domain

## courses

```text
id
user_id
title
description
goal
status
created_at
updated_at
```

## course_nodes

```text
id
course_id
knowledge_node_id

role
importance
position
metadata
```

多个 Course Node 可以指向同一个 Knowledge Node。

---

## course_edges

```text
id
course_id

from_course_node_id
to_course_node_id

relation
```

Course Edge 描述：

> 怎样教学。

Knowledge Edge 描述：

> 知识实际上怎样关联。

两者必须分开。

---

# 12. Learning Path

```text
learning_paths

id
session_id
version
created_at
updated_at
```

```text
learning_path_nodes

id
path_id
knowledge_node_id

type
position
status
source
metadata
```

类型：

```text
main
prerequisite
detour
```

Side Note 不一定进入 Learning Path。

---

# 13. Learning Session

```text
learning_sessions

id
user_id
course_id

current_knowledge_node_id

status

started_at
last_active_at
completed_at
```

对应一个 Tutor Pi Session。

但重要不变量：

> **Pi Session 是上下文，不是业务状态。**

Lesson、Path、Knowledge State 都以 PostgreSQL 为真相源。

---

# 14. Lesson Schema v1

```ts
interface Lesson {
  schemaVersion: "1.0";

  id: string;
  courseId: string;
  knowledgeNodeId: string;

  title: string;
  objective?: string;

  version: number;

  blocks: LessonBlock[];

  status:
    | "generating"
    | "active"
    | "completed";
}
```

支持：

```ts
type LessonBlock =
  | TextBlock
  | CodeBlock
  | DiagramBlock
  | QuizBlock;
```

---

# 15. Lesson Renderer

```text
Lesson
 ↓
LessonBlockRenderer
 ↓
type
 ├── text → TextBlockView
 ├── code → CodeBlockView
 ├── diagram → DiagramBlockView
 └── quiz → QuizBlockView
```

Renderer 不知道：

- Pi
- Prompt
- Database
- Agent reasoning

只理解 Protocol。

---

# 16. Lesson Patch Protocol

AI 不重新生成整个页面。

统一支持：

```text
insert
replace
update
remove
move
```

请求必须带版本：

```ts
interface ApplyLessonPatchRequest {
  lessonId: string;
  baseVersion: number;
  patches: LessonPatch[];
}
```

服务器校验：

```text
baseVersion == currentVersion
```

否则：

```text
VERSION_CONFLICT
```

---

# 17. Lesson Persistence

```text
lessons

id
session_id
course_id
knowledge_node_id

title
objective

version
status
```

```text
lesson_versions

id
lesson_id
version
parent_version

snapshot JSONB
patches JSONB

created_at
```

支持：

- Undo
- Debug
- Replay
- Audit

---

# 18. Assessment

```text
assessments

id
user_id
session_id
knowledge_node_id

lesson_id
block_id

type
result
score
confidence

feedback
evidence JSONB

created_at
```

Agent 不直接设置：

```text
mastered = true
```

正确流程：

```text
Quiz
 ↓
Agent evaluates evidence
 ↓
assessment_record
 ↓
KnowledgeService
 ↓
UserKnowledgeState update
```

业务规则决定最终 Knowledge State。

---

# 19. Tutor Domain Tools

MVP 控制在约十个：

```text
knowledge_get
knowledge_search
knowledge_update

lesson_get
lesson_create
lesson_patch

path_get
path_patch

assessment_record

document_search
```

以后增加：

```text
artifact_read
source_search
source_read
graph_neighbors
claim_read
```

---

# 20. API

## Courses

```http
GET  /api/courses
POST /api/courses

GET  /api/courses/:courseId
GET  /api/courses/:courseId/graph
```

创建：

```json
{
  "prompt": "我要学习 Transformer，最后理解 GPT"
}
```

---

## Learning

```http
POST /api/courses/:courseId/sessions

GET  /api/sessions/:sessionId

POST /api/sessions/:sessionId/messages
```

---

## Lesson

```http
GET /api/lessons/:lessonId
```

Quiz：

```http
POST /api/lessons/:lessonId/blocks/:blockId/answer
```

---

# 21. SSE

Learning Room 使用：

```http
GET /api/sessions/:sessionId/events
```

而不是初期直接 WebSocket everywhere。

核心通信模式：

```text
Client
→ HTTP Action

Server
→ SSE Event Stream
```

适合：

- Token streaming
- Lesson patch
- Assessment
- Path changes
- Agent state

---

# 22. Learning Event Protocol

统一 Envelope：

```ts
interface LearningEvent<T> {
  id: string;
  seq: number;

  type: LearningEventType;

  sessionId: string;

  timestamp: string;

  data: T;
}
```

v1：

```text
agent.started
agent.text.delta
agent.completed

lesson.created
lesson.patch

path.patch

assessment.completed

knowledge.updated

session.updated

error
```

---

# 23. SSE 可恢复性

`seq` 必须单调递增。

客户端保存：

```text
lastAppliedSeq
```

重连后：

```text
Last-Event-ID
```

继续消费。

事件处理必须幂等，避免断线后：

```text
同一个 Block 被插入两次。
```

---

# 24. Knowledge Compiler

知识摄入正式采用：

```text
Upload
 ↓
Parse
 ↓
Normalize
 ↓
Analyze
 ↓
Resolve
 ↓
Compile
 ↓
Link
 ↓
Verify
 ↓
Index
 ↓
Course Impact
```

不是简单：

```text
upload → chunk → embed
```

---

# 25. Source Layer

```text
documents

document_sections

document_chunks
```

Chunk 是证据，不是最终知识。

Raw Source 不允许 LLM 修改。

---

# 26. Knowledge Artifact

知识 Node 负责：

> identity。

Artifact 负责：

> synthesis。

例如：

```text
Self Attention

Definition
Intuition
Mechanism
Prerequisites
Formula
Examples
Misconceptions
Sources
```

表：

```text
knowledge_artifacts
knowledge_artifact_versions
```

---

# 27. Artifact Schema

不同类型必须使用固定 Schema：

```text
Concept

definition
intuition
mechanism
prerequisites
examples
misconceptions
related
```

```text
Algorithm

purpose
inputs
outputs
procedure
complexity
example
pitfalls
```

防止知识结构随着 Prompt 漂移。

---

# 28. Claim / Evidence

## claims

```text
id
subject_node_id
statement
status
confidence
created_at
updated_at
```

状态：

```text
supported
conflicting
uncertain
deprecated
```

## claim_evidence

```text
id
claim_id
chunk_id

relation
confidence
```

关系：

```text
supports
contradicts
qualifies
```

任何重要编译知识都应该最终可追溯：

```text
Artifact
 ↓
Claim
 ↓
Evidence
 ↓
Source
```

---

# 29. Knowledge Incremental Update

新增资料：

```text
new source
 ↓
extract candidate
 ↓
search existing knowledge
 ↓
resolve entity
 ↓
compare claims
 ↓
CREATE / PATCH / NOOP / CONFLICT
```

不重建整个 Wiki。

知识修改采用 Knowledge Patch + Version。

---

# 30. Entity Resolution

候选：

```text
Self Attention
Self-Attention
自注意力
```

流程：

```text
exact aliases
 ↓
lexical search
 ↓
semantic similarity
 ↓
LLM resolution when ambiguous
```

最终只允许：

```text
link_existing
create_new
manual_review
```

LLM 不允许直接 merge database rows。

---

# 31. Agentic Retrieval

Tutor 拥有：

```text
knowledge_search
artifact_read

source_search
source_read

graph_neighbors

claim_read
```

典型路径：

```text
Question
 ↓
knowledge_search
 ↓
artifact_read
 ↓
Enough?
 ├─ Yes → Teach
 └─ No
     ↓
   source_search
     ↓
   source_read
     ↓
   graph / verify
```

---

# 32. Retrieval Budget

不是所有问题都启动 Agentic RAG。

### Level 0

不检索：

> “把刚才讲简单一点。”

### Level 1

```text
knowledge_search
→ artifact_read
```

### Level 2

```text
search
→ read
→ source
→ graph
→ verify
```

适合复杂、多跳或事实敏感问题。

必须有最大 step budget 和停止条件。

---

# 33. Retrieval 与 Teaching 分离

禁止：

```text
RAG result → UI
```

必须：

```text
Retrieval
 ↓
Evidence
 ↓
Teach Skill
 ↓
Lesson / Lesson Patch
 ↓
Renderer
```

因此：

- Retrieval 决定知道什么
- Teach 决定怎样解释
- Renderer 决定怎样展示

---

# 34. Document Worker

长文档处理不得绑定 HTTP 生命周期。

建立：

```text
IngestionRun
```

状态：

```text
queued
parsing
analyzing
resolving
compiling
verifying
indexing
completed
failed
```

每个 Stage 必须尽量：

- 幂等
- 可重试
- 可独立恢复

例如 Compile 失败无需重新解析 PDF。

---

# 35. 文件更新

通过内容 hash 判断。

```text
same hash
→ NOOP
```

变化：

```text
changed sections
 ↓
affected evidence
 ↓
affected claims
 ↓
artifact patch
```

---

# 36. 文件删除

不能只删除 chunks。

必须：

```text
Remove Source
 ↓
Remove Evidence
 ↓
Recalculate Claim
 ↓
supported → uncertain?
 ↓
Recompile Artifact
 ↓
Reindex
```

否则 Living Knowledge 会产生无来源信息。

---

# 37. Skill 迁移

当前 Skills 中基于：

```text
.alvar/*.md
```

的 persistence 逻辑必须移除。

例如：

```text
LEARNER.md
→ UserProfile Service

maps/*.md
→ Knowledge Service

sessions/*.md
→ Learning Session Service
```

保留：

- 教学方法
- reasoning workflow
- probe 策略
- visual 原则
- verify 原则

替换：

- 文件系统状态存储

---

# 38. 前端状态

Learning Room：

```ts
interface LearningRoomState {
  courseId: string;
  sessionId: string;

  currentNodeId: string;

  path: LearningPathNode[];

  lesson: Lesson;
  lessonVersion: number;

  tutorMessages: TutorMessage[];

  pendingPatches: LessonPatch[];

  assessment?: AssessmentState;
}
```

不要把：

- LLM Prompt
- Pi internal event
- DB entity internals

暴露给前端。

---

# 39. HarmonyOS 适配

从现在开始必须避免 Core 依赖 DOM。

架构：

```text
Lesson Protocol
      │
      ├── React Renderer
      │       ↓
      │      Web
      │
      └── ArkUI Renderer
              ↓
          HarmonyOS
```

后续鸿蒙化可分两阶段。

### Phase A

ArkUI 原生 Shell + ArkWeb 复用已有 Learning Room。

用于快速迁移。

### Phase B

ArkTS 实现：

```text
Lesson Renderer
Course UI
Learning Path
Tutor
```

继续调用相同：

```text
HTTP API
SSE
Lesson Protocol
Patch Protocol
```

因此 Agent / Knowledge / Course / DB 均无需重写。

---

# 40. MVP 数据库表

```text
users
user_profiles

knowledge_nodes
knowledge_edges
user_knowledge_states

courses
course_nodes
course_edges

learning_sessions
learning_paths
learning_path_nodes

lessons
lesson_versions

assessments
learning_events

documents
document_sections
document_chunks

ingestion_runs

knowledge_artifacts
knowledge_artifact_versions

claims
claim_evidence

agent_sessions
```

第二阶段再加入：

```text
knowledge_patches
retrieval_traces
knowledge_lint_issues
```

---

# 41. MVP 开发顺序

### Phase 1 — Protocol

实现：

```text
Course
Knowledge
Lesson
Patch
Assessment
Events
```

### Phase 2 — Learning Runtime without AI

手工建立 Transformer Course。

实现：

```text
Course Map
Learning Path
Lesson Renderer
Quiz
Patch
```

### Phase 3 — Server

实现：

```text
REST
SSE
PostgreSQL
Lesson Version
```

### Phase 4 — Pi Runtime

先只开放：

```text
knowledge_get
lesson_create
lesson_patch
```

跑通：

```text
Tutor
→ Tool
→ Lesson
```

### Phase 5 — Teach / Probe

迁移现有 Skills。

形成：

```text
Goal
→ Probe
→ Teach
→ Quiz
→ Knowledge State
```

### Phase 6 — Knowledge Compiler

先支持：

```text
Markdown
PDF text
```

实现：

```text
Source
→ Artifact
→ Search
```

### Phase 7 — Agentic Retrieval

加入：

```text
artifact_read
source_search
source_read
```

最终形成第一条完整链：

```text
Upload Transformer Paper
        ↓
Knowledge Compiler
        ↓
Living Knowledge
        ↓
Create Transformer Course
        ↓
Learning Room
        ↓
Teach Attention
        ↓
User asks a question
        ↓
Agentic Retrieval
        ↓
Lesson Patch
        ↓
Assessment
        ↓
Knowledge State
```

---

# 42. 架构不变量

这些原则后续除非有明确证据，否则不应轻易修改：

1. **TypeScript 是主语言。**
2. **Protocol 与具体 UI / Agent Runtime 解耦。**
3. **Raw Source 永远不被 LLM 修改。**
4. **Knowledge 与 User Knowledge State 分离。**
5. **Course Graph 与 Global Knowledge Graph 分离。**
6. **Learning Path 是动态用户级状态。**
7. **AI 不直接生成任意 HTML / JS。**
8. **AI 所有写操作必须经过 Typed Domain Tool。**
9. **所有 Lesson 修改采用 Patch + Version。**
10. **Agent Session 不是 Domain State。**
11. **Tutor 优先读取 Compiled Knowledge，必要时才读取 Raw Source。**
12. **Agentic Retrieval 必须有成本预算和停止条件。**
13. **Retrieval、Teaching、Rendering 三层严格分离。**
14. **Web 与 HarmonyOS 共享业务协议，而不是共享 DOM 实现。**

---

# 43. 最终技术模型

```text
                         OpenTutor

                   ┌─────────────┐
                   │ Raw Sources │
                   └──────┬──────┘
                          ↓
                Knowledge Compiler
                          ↓
              ┌────────────────────┐
              │  Living Knowledge  │
              │ Artifact / Claim   │
              │ Evidence / Graph   │
              └─────────┬──────────┘
                        ↓
                 Agentic Retrieval
                        ↓
User Goal ──────→ Learning Compiler ←──── User State
                        ↓
                   Course Graph
                        ↓
                  Learning Path
                        ↓
                   Tutor Runtime
                        ↓
                  Lesson Protocol
                        ↓
                   Patch Protocol
                        ↓
             ┌──────────┴──────────┐
             ↓                     ↓
        React Renderer         ArkUI Renderer
             ↓                     ↓
            Web                HarmonyOS
```

OpenTutor 的技术核心因此不是某个 LLM、某个 RAG Framework 或某个前端框架，而是三套稳定能力：

> **Living Knowledge Model + Learning State Model + Dynamic Lesson Protocol**

外层实现可以变化，这三层应长期稳定。