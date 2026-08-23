# Exam-Killer: 期末复习资料生成工具

## Context

本地大学生考试复习工具。用户上传往年试卷 PDF（及配套答案 PDF），系统调用 MinerU Python SDK 解析为 Markdown + 结构化 JSON，然后用 LLM Agent（read/write/edit 三工具循环）抽取题目、生成分类题库，并串行生成按章节组织的复习手册。用户自备 MinerU Token（用于解析）和 LLM API Key（用于 Agent）。纯本地运行，数据存文件 + SQLite 索引，前端 SPA 渲染。

---

## Approach

### Phase 0: 项目骨架

**Step 0.1 — 创建目录结构**

```
exam-killer/
├── data/                         # 所有用户数据（gitignored）
│   └── {course}/                 # 课程名 sanitize 后做目录名
│       ├── uploads/              # 上传的原始文件
│       ├── raw/                  # SDK 解析输出
│       │   └── {file_id}/        # 单份文件解析结果
│       │       ├── output        # MD 文件
│       │       ├── images/       # 图片
│       │       └── content_list.json
│       ├── assets/               # Agent 拷贝的图片
│       ├── question-bank.md      # Agent 写，一手数据
│       ├── review-guide/         # Agent 写，按章节
│       │   ├── 01-极限与连续.md
│       │   └── ...
│       └── _counter.txt          # QID 计数器
├── backend/
│   ├── __init__.py
│   ├── main.py                   # FastAPI 入口 + SSE
│   ├── config.py                 # 路径、DB 配置
│   ├── db.py                     # SQLite 初始化 + CRUD
│   ├── models.py                 # Pydantic 模型
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── courses.py            # 课程 CRUD
│   │   ├── files.py              # 上传 + 解析
│   │   ├── questions.py          # 题库查询
│   │   └── review.py             # 复习手册
│   ├── sdk_extract.py            # MinerU SDK 封装
│   ├── sse.py                    # SSE 推送
│   ├── llm.py                    # LLM Provider
│   └── agent/
│       ├── __init__.py
│       ├── core.py               # Agent 循环 + 工具
│       └── prompts/
│           ├── __init__.py
│           ├── classifier.py
│           ├── extractor.py
│           └── review.py
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js
│       ├── router.js
│       ├── courses.js
│       ├── course-detail.js
│       ├── upload.js
│       ├── question-bank.js
│       ├── review-guide.js
│       ├── export.js
│       └── renderer.js
├── config.py
├── requirements.txt
└── README.md
```

**Step 0.2 — requirements.txt**

```
fastapi>=0.115
uvicorn[standard]>=0.34
mineru-open-sdk>=0.2.5
httpx>=0.27
python-multipart>=0.0.9
```

不含 LLM SDK——用 httpx 直调 OpenAI 兼容 REST API。

**Step 0.3 — backend/config.py**

```python
from pathlib import Path
import re

DATA_DIR = Path("data")
DB_PATH = Path("exam_killer.db")
MAX_PAGES = 30

def sanitize_dirname(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', ' ', name).strip()
```

**Step 0.4 — SQLite schema**（`backend/db.py`）

```sql
CREATE TABLE courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  dir_name TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  raw_dir TEXT,
  error_msg TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qid TEXT UNIQUE NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  source_file_id INTEGER REFERENCES files(id),
  qtype TEXT DEFAULT '',
  content TEXT NOT NULL,
  options TEXT,
  answer TEXT,
  explanation TEXT,
  knowledge_tags TEXT,
  difficulty INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE knowledge_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  tag_name TEXT NOT NULL,
  UNIQUE(course_id, tag_name)
);
```

**Step 0.5 — 基础 SPA 框架**

hash 路由，三个视图：课程列表 → 课程详情（选项卡） → 各功能页。纯 JS，无框架。

---

### Phase 1: 课程 + 文件 + 解析

**Step 1.1 — 课程 CRUD**

GET/POST/DELETE `/api/courses` 和 `/api/courses/{id}`。创建课程时自动建目录、写 question-bank.md 初始头、写 _counter.txt 为 `0`。

**Step 1.2 — 文件上传**

POST `/api/courses/{id}/files`（multipart）。支持多文件。保存到 uploads/，SQLite 记录，status=pending。

**Step 1.3 — 触发解析**

POST `/api/courses/{id}/parse`
- 请求体：`{"mineru_token": "...", "file_ids": [1,2,3]}`
- 启动 asyncio 后台任务，立即返回 202
- 后台任务对每个 file_id：
  1. `update_status(file_id, "extracting")` + SSE 推送
  2. 用 `MinerU(token).extract(path, model="vlm", pages="1-30")` 解析
  3. `result.save_markdown(raw/{file_id}/output, with_images=True)`
  4. `json.dump(result.content_list)` 到 `content_list.json`
  5. `update_status(file_id, "parsed")`
- 全部完成后 → 启动 Agent 文件分类 → 启动 Agent 题目抽取（串行） → 同步 SQLite → SSE "done"
- SDK 阻塞调用用 `asyncio.to_thread()` 避免阻塞事件循环

**Step 1.4 — SSE**

GET `/api/courses/{id}/parse/events`。后台任务用 asyncio.Queue 发进度，SSE 端点消费。

---

### Phase 2: Agent 核心

**Step 2.1 — LLM Provider（`backend/llm.py`）**

```python
import httpx

class LLMProvider:
    def __init__(self, api_key: str, endpoint: str, model: str):
        self.client = httpx.AsyncClient(base_url=endpoint.rstrip("/chat/completions"))
        self.api_key = api_key
        self.model = model

    async def chat(self, messages: list[dict]) -> str:
        resp = await self.client.post("/chat/completions", json={
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 8192,
        }, headers={"Authorization": f"Bearer {self.api_key}"})
        return resp.json()["choices"][0]["message"]["content"]
```

支持任意 OpenAI 兼容端点。Gemini/Claude 用户自己加映射。

**Step 2.2 — Agent 循环（`backend/agent/core.py`）**

Agent 有 read/write/edit 三种工具。LLM 回复中用以下格式指示动作：

```
TOOL: read("path")
---
TOOL: write("path")
content
---
TOOL: edit("path", "old text", "new text")
---
DONE
```

实现要点：
- `parse_action()` 用正则提取 `^TOOL: (\w+)\(`，然后根据类型解析参数
- `execute_action()` 在 work_dir 内操作，拦截 `..` 路径
- 连续 3 次一致 read → 终止
- 超时 300s
- 每次工具调用结果追加到 messages 中

---

### Phase 3: Agent——文件分类

**Step 3.1 — classifier prompt**

Agent 读取 raw/ 下每个 file 的 output 文件 → 判断 questions_only / answers_only / mixed → 写 _manifest.json。

_manifest.json 格式：
```json
{
  "files": {
    "1": {"type": "questions_only", "original": "xxx_题目.pdf", "pair_key": "2023期末"},
    "2": {"type": "answers_only", "original": "xxx_答案.pdf", "pair_key": "2023期末"}
  }
}
```

**Step 3.2 — 执行时机**

后台解析任务完成后自动触发。

---

### Phase 4: Agent——题目抽取

**Step 4.1 — extractor prompt 要点**

- 读取 raw/{file_id}/output 的 MD
- 如有配对答案文件，一起读
- 读取现有 question-bank.md（了解已有标签）
- 读取 _counter.txt（获取起始 QID）
- 逐题提取，包括：题型、题干、选项、答案、解析、知识点标签、难度
- 图片路径转成 `assets/{hash}.jpg`，并从 raw 拷贝到 assets/
- 写入 question-bank.md 末尾
- 更新 _counter.txt
- 每道题用 `---` 分隔，格式严格遵循 plan 中定义的模板

**Step 4.2 — 串行执行**

每份文件（或配对）启动一个 Agent，完成后再处理下一份。每个 Agent 完成后立即同步 SQLite。

---

### Phase 5: 题库同步 + 前端

**Step 5.1 — sync_questions_from_md()**

正则 `### (Q\d+)\n(.*?)(?=\n### |\Z)` 提取所有题目块。逐字段解析。全量重建：DELETE + INSERT 在同一事务中。如果有 INSERT 失败则回滚。

**Step 5.2 — 题库 API**

GET `/api/courses/{id}/questions?tag=xxx&type=xxx`
GET `/api/courses/{id}/tags`

**Step 5.3 — 前端题库渲染**

左侧标签导航（从 `/api/tags` 获取）。点击标签加载题目列表。marked.js + KaTeX 渲染。图片通过 `/api/assets/{dir_name}/images/{hash}` 代理访问。答案可折叠。按题型/难度筛选（前端或后端均可，v0.1 先用后端筛选）。

**Step 5.4 — Asset 代理**

GET `/api/assets/{dir_name}/images/{filename}` 优先查找 data/{dir_name}/assets/，没找到则搜所有 raw 下的 images/ 做 fallback。

---

### Phase 6: 复习手册

**Step 6.1 — 大纲规划 Agent**

读取 question-bank.md → 输出章节名称列表（每行一个章节）。

**Step 6.2 — 串行章节 Agent**

每个章节 Agent 的 prompt 包含：
- 课程名称、章节标题/编号
- 用户可选大纲
- 已有章节的摘要列表（文件名 + 第一段）
- 完整题库

输出写入 `review-guide/{02}-{标题}.md`，引用格式 `[Qxxxx]`。

**Step 6.3 — API**

POST `/api/courses/{id}/generate-review` → 触发生成（带 llm_key/endpoint/model + 可选 outline）
GET `/api/courses/{id}/review/chapters`
GET `/api/courses/{id}/review/chapters/{name}` → 返回 MD 内容

**Step 6.4 — 前端 `[Qxxxx]` 展开**

marked 自定义渲染器：遇到 `[Q\d+]` 模式 → 前端从预加载的全局题目映射中查找 → 替换为题目卡片。预加载方式：页面加载时一次 GET `/api/courses/{id}/questions` 获取全部题目。

---

### Phase 7: 导出

GET `/api/courses/{id}/export/md?scope=question-bank|review-guide` — 直接返回 MD 或 zip。

PDF：html2pdf.js（CDN）在前端生成。用户点击导出 → 当前渲染内容（含展开的题目卡片）转 PDF。不涉及服务端。

---

## Verification

1. 单元测试：`test_sync_questions_from_md.py`（5 道题 MD → SQLite）
2. 单元测试：`test_agent_core.py`（mock LLM → 验证工具调用循环）
3. 集成测试：用 `2223_大物1A2A.pdf`（在项目根目录）手动验证解析 → SDK 产出 md+images+content_list
4. 手动启动 FastAPI：`uvicorn backend.main:app` → 浏览器打开 localhost:8000 → 创建课程 → 上传 → 解析 → 题库 → 复习手册 → 导出

---

## Assumptions & contingencies

| Assumption | Fallback if false |
|---|---|
| 用户 LLM 兼容 OpenAI chat completions 格式 | 仅支持 OpenAI 格式。Gemini/Claude 需映射 |
| SDK pages 参数控制有效 | 无效则 prompt 写截断策略 |
| SQLite 全量重建安全 | 先 INSERT 到临时表，成功后再 DELETE 旧数据 |
| 用户用现代浏览器 | EventSource 和 async/await 标准 API |
