# OpenTutor 产品需求文档 (PRD)

---

## 1. 产品概述与定位

### 1.1 产品愿景
**OpenTutor** 是一个 **AI 原生自适应交互学习空间（AI-Native Learning Space）**。
传统的在线教育是“静态课程 → 章节列表 → 刷视频/翻试卷”，AI 仅充当外部客服。OpenTutor 将其重构为：
- **课程是入口**：以用户学习目标为导向，动态编译课程图谱；
- **知识图谱是底层**：以依赖 DAG 追踪掌握度边界，实现个性化自适应；
- **AI Tutor 是控制层**：对话框作为教学控制台，随时调整难度与路径；
- **Lesson Canvas 是交互核心**：基于标准 **Lesson Schema (JSON)** 渲染多模态交互画布。

### 1.2 核心设计哲学
1. **单人自适应教学（Alvar 教学法）**：一对一量身定制，只在理解边界教学（不重复已知的，不空降前置未知的）。
2. **Schema 驱动渲染**：AI 绝不直接输出不可控的 HTML，而是输出严格结构化 JSON，由前端 Component Registry 渲染。
3. **控制层与展示层分离**：聊天框不是主学习区，而是“学习控制面板（Control Panel）”；主体学习在交互画布（Canvas）中完成。
4. **渐进式跨端**：Web 优先验证（React / Next.js），通过 ArkWeb 混合容器无缝嵌入鸿蒙系统，未来平滑演进为 ArkUI 原生渲染器。

---

## 2. 核心用户流程 (User Journey)

```
[用户输入学习目标] (例: "我要学 Transformer, 目标是理解 GPT 原理")
         │
         ▼
[模块 1: 目标分析 (Goal Analyzer)] ── 提取目标、深度要求、学习模式
         │
         ▼
[模块 1: 课程图谱生成 (Course Graph Builder)] ── 规划依赖 DAG 与前置关系
         │
         ▼
[模块 2: 掌握度二分探测 (Probe)] ── 交互式多选测验, 标定 known/edge/unknown
         │
         ▼
[模块 1: 学习路径编排 (Path Planner)] ── 生成当前 Mermaid 学习路径
         │
         ▼
[模块 2: 单步推理教学 (Teach Engine)] ── 针对当前节点生成 Lesson Schema
         │
         ▼
[模块 3: 交互画布渲染 (Lesson Canvas)] ── 渲染 Text / Formula / Diagram / Quiz
         │
         ▼
[模块 2: 即时锁定测验 (Lock-in Quiz)]
    ├── 答对 ──► 更新节点为 mastered ──► 推进到下一个 DAG 节点
    └── 答错/疑惑 ──► 停留本节点 或 触发【模块 4】动态插入前置补齐节点
         ▲
         │ (用户随时通过控制台对话干预: "太难了" / "用代码解释" / "先讲线代")
[模块 4: 教学控制台 (Control Panel)] ── 动态重编排 DAG / 改写 Block Schema
```

---

## 3. 功能模块详细设计

---

### 模块 1：目标解析与课程图谱生成模块 (Course Graph & Path Module)

#### 1.1 功能说明
负责将用户的自然语言目标（或上传的教材/资料）转化为结构化的课程依赖图谱（Course DAG）与个性化学习路径。

#### 1.2 子功能与规则
1. **Goal Analyzer（目标分析）**：
   - 提取三要素：`topic`（主题）、`target`（达成目标）、`depth`（`basic | intermediate | advanced`）、`mode`（`engineering | academic | intuitive`）。
2. **Course Graph Builder（课程图谱生成）**：
   - 生成由 Course Nodes 与 Directed Edges 组成的教学 DAG。
   - 每个节点定义：`id`、`title`、`objective`、`prerequisites`（前置依赖列表）、`estimatedMinutes`。
3. **Learning Path Planner（学习路径规划）**：
   - 结合用户基线画像过滤掉已掌握的节点，输出线性的拓扑有序执行序列。

#### 1.3 核心数据契约
```typescript
export interface CourseGraph {
  courseId: string;
  topic: string;
  target: string;
  nodes: CourseNode[];
  edges: { from: string; to: string }[];
}

export interface CourseNode {
  id: string;
  title: string;
  objective: string;
  prerequisites: string[];
  status: 'unknown' | 'known' | 'edge' | 'blocked' | 'mastered';
  order: number;
}
```

---

### 模块 2：Alvar 认知教学与探测引擎 (Alvar Tutoring Engine)

#### 2.1 功能说明
严格执行 Alvar 认知教学法（Probe → Plan → Teach → Lock-in），确保一次只讲一个推理步，并在每个节点强制闭环验证。

#### 2.2 子功能与规则
1. **Probe（掌握度二分探测）**：
   - 学习前对关键前置依赖进行 1–3 题微测验（每题必须含“我不知道”防猜选项）。
   - 将依赖节点状态划分为：`known`（已掌握）、`edge`（临界）、`unknown`（未知）、`blocked`（前置阻塞）。
2. **Step-by-Step Teach（单步教学生成）**：
   - 一次只生成当前知识节点所必需的内容，杜绝长篇大论（ChatGPT 常见坏味道）。
   - 依赖 `learn-visual`：针对抽象概念自动生成精准匹配结论的 SVG / Mermaid 结构图。
   - 依赖 `learn-verify`：对于定理、历史事实进行严格核验，避免幻觉。
3. **Lock-in Quiz（即时锁定测验）**：
   - 节点末尾必须配置 Lock-in 测验。
   - 只有通过测验，当前节点才跃迁为 `mastered` 并推进到下一节点；未通过则触发提示重试或插入补充前置。

---

### 模块 3：结构化内容协议与交互画布 (Lesson Schema & Canvas)

#### 3.1 功能说明
定义 AI 与前端解耦的“学习内容协议”，前端 Lesson Renderer 基于 Component Registry 将 Schema 渲染为富交互页面。

#### 3.2 Block 组件体系
| Block 类型 | 字段定义 | 渲染组件行为 |
| :--- | :--- | :--- |
| **`text`** | `content: string` | Markdown 渲染、高亮排版、重点标注 |
| **`formula`** | `latex: string`, `explanation?: string` | KaTeX 数学公式渲染 |
| **`diagram`** | `format: 'svg' \| 'mermaid'`, `data: string`, `claim: string` | SVG 自适应矢量图 / Mermaid 动态流程图 |
| **`code`** | `language: string`, `code: string`, `runnable?: boolean` | 语法高亮代码块、代码执行/输出容器 |
| **`simulation`** | `component: string`, `initialState: any` | 前端预置交互小部件（如 Attention 权重滑块、Token 矩阵拖拽） |
| **`quiz`** | `quizType: 'mcq' \| 'connector' \| 'categorizer'`, `prompt`, `options`, `answer` | 交互式选择题、连线题、分类拖拽题 |

#### 3.3 Lesson Schema 定义
```typescript
export interface LessonSchema {
  id: string;
  nodeId: string;
  title: string;
  objective: string;
  blocks: LessonBlock[];
  lockInQuiz: {
    question: string;
    options: { id: string; text: string; isCorrect: boolean }[];
    explanation: string;
  };
}

export type LessonBlock =
  | { type: 'text'; content: string }
  | { type: 'formula'; latex: string; explanation?: string }
  | { type: 'diagram'; format: 'svg' | 'mermaid'; data: string; claim: string }
  | { type: 'code'; language: string; code: string; runnable?: boolean }
  | { type: 'simulation'; component: string; state: Record<string, any> }
  | { type: 'quiz'; prompt: string; options: string[]; answer: string };
```

---

### 模块 4：AI Tutor 教学控制台与动态干预 (Tutor Control Panel)

#### 4.1 功能说明
将传统聊天窗口重塑为 **教学控制面板（Control Panel）**，支持通过自然语言随时干预正在进行的教学。

#### 4.2 动态响应能力
1. **表达形式切换**：
   - 用户：“太抽象了，用代码解释” → Tutor 实时将当前的 `diagram` Block 重构为 Python `code` Block。
2. **难度动态伸缩**：
   - 用户：“简单一点，不用公式” → Tutor 降低难度，移除 `formula` Block，增加直观生活比喻的 `text` 与 `diagram` Block。
3. **知识图谱动态插拔 (DAG Surgery)**：
   - 用户：“我不知道 Token 是什么” → Tutor 判定知识断层，即时在 DAG 中插入 `[Tokenization]` 补充节点，优先进入补充节点学习，完成后自动跳回原主线。

---

### 模块 5：学习状态机与画像存储 (Learner Profile & State Store)

#### 5.1 功能说明
负责学习者长期认知习惯、单课时进度（Lesson Progress）以及知识图谱状态的持久化存储。

#### 5.2 数据定义
1. **Learner Profile (`.alvar/LEARNER.md` / SQLite)**：
   - `pace`: 单步推进节奏。
   - `strugglePolicy`: 偏好自主解题还是引导式提示。
   - `tone & density`: 精炼/平实/专业。
   - `solidGround`: 用户已掌握的底层学科体系（如 Python, 基础微积分）。
2. **Lesson Progress**：
   - 记录已完成 Blocks、错题记录（`failedQuestions`）、学习耗时。
3. **Global/Course Graph State**：
   - 记录各节点当前掌握度等级（`unknown -> edge -> mastered`）。

---

### 模块 6：跨端适配与容器架构 (Cross-Platform & ArkWeb Strategy)

#### 6.1 架构设计
- **Web 端（P0）**：Next.js 14 / React 18 + Tailwind CSS + Framer Motion，作为通用交互学习空间。
- **鸿蒙 ArkWeb 混合容器（P1）**：
  - 将 Web 交互画布构建为静态资源包放入鸿蒙 `rawfile/` 或由 ArkWeb 加载。
  - 通过 `registerJavaScriptProxy` 建立 ArkWeb 与 ArkTS Bridge：
    - Web 端：负责富交互 Lesson 渲染、动画、题型交互；
    - ArkTS 端：负责系统通知、打卡提醒、本地文件/离线数据库存储、系统级权限与后台保活。
- **ArkUI 原生渲染演进（P2）**：
  - 维持后端与 Agent 输出的 `LessonSchema JSON` 不变，仅在鸿蒙端实现一套基于 ArkUI 声明式语法的 `LessonRenderer`，实现 100% 鸿蒙原生级高性能体验。

---

## 4. MVP 验收标准 (Acceptance Criteria)

| 序号 | 功能用例 | 可机械判定的验收标准 |
| :---: | :--- | :--- |
| **AC-1** | 目标解析与图谱生成 | 输入学习目标字符串，系统输出合法 `CourseGraph` JSON，包含至少 3 个带有前后依赖关系的 `CourseNode`。 |
| **AC-2** | Alvar Probe 探测流程 | 启动课程时触发 1–3 题二分测验，用户提交答案后，系统根据对错精确标记节点的 `known/edge/unknown` 状态。 |
| **AC-3** | Lesson Schema 渲染 | 输入标准 `LessonSchema` JSON，前端 Lesson Canvas 能正确无误渲染 Text（Markdown）、KaTeX 公式、SVG/Mermaid 图解与单选 Quiz。 |
| **AC-4** | Lock-in 锁定机制 | 在当前 Lesson 页面，未答对 Lock-in 题目时不可进入下一课；答对后节点状态变更为 `mastered` 并自动高亮下一关。 |
| **AC-5** | 对话动态干预 | 在对话控制台中输入“换成代码演示”，系统返回更新后的 `LessonSchema` 并将图示块替换为代码块，画布实时重新渲染。 |
| **AC-6** | 跨端 Web/ArkWeb 就绪 | 前端 Web 产物构建无报错（`npm run build` exit 0），可在标准浏览器及 ArkWeb 容器中自适应全屏运行。 |
