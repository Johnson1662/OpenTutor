# OpenTutor Product Requirements Document v1.0

**版本：** v1.0  
**产品形态：** Web First，后续适配 HarmonyOS  
**定位：** AI Native 个性化学习系统

---

## 1. 产品定义

OpenTutor 是一个能够持续理解用户知识状态，并动态生成、调整和执行学习过程的 AI Tutor。

它不是传统的：

- AI 问答工具
- AI 课程生成器
- 题库应用
- PDF Chat
- 固定课程平台

核心闭环是：

```text
学习目标
   ↓
理解已有知识
   ↓
构建课程知识图谱
   ↓
规划个性化学习路径
   ↓
动态生成交互式 Lesson
   ↓
诊断 / 教学 / 练习
   ↓
更新用户知识状态
   ↓
重新规划
```

产品核心公式：

> **OpenTutor = Living Knowledge + Personal Knowledge State + AI Tutor + Dynamic Learning UI**

---

# 2. 产品问题

现有 AI 学习产品普遍存在四个结构性问题。

### 2.1 AI 不真正了解用户

普通聊天系统主要使用对话上下文，没有稳定的：

- 已掌握知识
- 薄弱知识
- 前置知识缺失
- 学习轨迹
- 学习偏好

因此每次对话很难形成长期学习连续性。

### 2.2 课程通常是静态的

传统结构：

```text
课程
→ Chapter
→ Lesson 1
→ Lesson 2
→ Lesson 3
```

但真实学习不是线性的。

用户可能：

- 已经掌握部分内容
- 中途发现缺少前置知识
- 希望换一种解释方式
- 临时改变学习目标
- 因考试改变学习优先级

因此课程必须可以实时变化。

### 2.3 Chat UI 不适合系统学习

大量教学产品只是：

```text
User
 ↓
Chat
 ↓
AI长文本
```

聊天适合交流，但不适合承载：

- 图
- 公式
- 代码
- 模拟
- 测验
- 知识路径
- 连续课程结构

OpenTutor 因此将 AI Chat 定义为**控制层**，而不是主要学习界面。

### 2.4 RAG 并不等于知识系统

传统：

```text
Document
→ Chunk
→ Embedding
→ Top-K
→ Prompt
```

无法稳定形成：

- 概念体系
- 知识关系
- 来源追踪
- 交叉资料综合
- 冲突检测
- 长期可复用知识

OpenTutor 将文档首先编译为长期知识，再用于教学。

---

# 3. 核心产品模型

OpenTutor 由六个核心概念组成：

```text
Source
  ↓
Living Knowledge
  ↓
Course
  ↓
Learning Path
  ↓
Lesson
  ↓
User Knowledge State
```

---

## 3.1 Course

课程仍然是用户组织学习的主要单位。

例如：

```text
Transformer
CSAPP
Linear Algebra
Stanford CS336
```

Course 回答：

> “我正在学什么？”

而不是定义整个世界中的知识关系。

---

## 3.2 Global Knowledge Graph

所有课程共享一张全局知识图谱。

例如：

```text
Linear Algebra
      ↓
Matrix Multiplication
      ↓
Self Attention
      ↓
Transformer
      ↓
GPT
```

课程之间因此可以共享知识状态。

例如：

用户在 Linear Algebra 中已经掌握 Matrix Multiplication：

```text
Linear Algebra Course
       ↓
Matrix Multiplication ✓
       ↓
Transformer Course
```

Transformer 不应再次把它当作完全未知知识。

---

## 3.3 Course Knowledge Graph

每门课程拥有自己的教学图谱。

例如：

```text
Transformer Course

Token
  ↓
Embedding
  ↓
Self Attention
  ↓
Multi-Head Attention
  ↓
Transformer Block
  ↓
GPT
```

Course Graph 是 Global Knowledge Graph 的教学投影。

它表达：

> “为了完成这门课程，知识应该怎样组织？”

---

## 3.4 Learning Path

Course Graph 仍不是用户实际路线。

对于不同用户：

```text
标准路径：

A → B → C → D
```

用户已经掌握 B：

```text
A → C → D
```

学习 C 时发现缺少 X：

```text
A → C
     ↓
     X
     ↓
     C
     ↓
     D
```

因此 Learning Path 是：

> 针对某个用户、某次学习状态动态生成的路径。

---

# 4. 核心体验：Learning Room

Learning Room 是 OpenTutor 最重要的页面。

桌面结构：

```text
┌──────────────┬────────────────────────────┬──────────────┐
│ Learning     │                            │              │
│ Path         │       Lesson Canvas        │   AI Tutor   │
│              │                            │              │
└──────────────┴────────────────────────────┴──────────────┘
```

---

## 4.1 Learning Path

左侧显示当前学习路线：

```text
✓ Embedding
✓ Self Attention

● Multi-Head Attention

○ Transformer Block
○ GPT
```

如果 AI 发现前置知识缺失：

```text
Self Attention
      ↓
+ Softmax
      ↓
Multi-Head Attention
```

路径实时变化。

---

## 4.2 Lesson Canvas

Lesson Canvas 是主要学习区域。

它不是文章，也不是 Chat。

一个 Lesson 可以包含：

```text
Title

Explanation

Interactive Diagram

Formula

Code Example

Quiz

Adaptive Explanation
```

例如：

```text
Multi-Head Attention

Why do we need multiple heads?

[Interactive Diagram]

Head 1 → syntax
Head 2 → position
Head 3 → semantics

[Explanation]

Quick Check

Why might one attention head be insufficient?

[Answer]
```

---

## 4.3 AI Tutor

右侧 Tutor 是自然语言控制器。

用户可以：

> 讲简单一点。

> 用代码解释。

> 给我画个图。

> 先别讲公式。

> 我不懂 Softmax。

> 我已经会这个了，跳过去。

AI 的主要行为不是在右侧产生长回复，而是：

> **修改中间 Lesson 和左侧 Learning Path。**

例如：

```text
User:
“用代码解释。”

        ↓

Tutor

        ↓

Lesson Canvas 增加 Code Block
```

---

# 5. Dynamic Lesson

OpenTutor 不允许模型直接输出任意 HTML 页面。

模型生成结构化 Lesson：

```text
AI
 ↓
Lesson Schema
 ↓
Renderer
 ↓
Interactive Web Page
```

Web 阶段最终仍然呈现为 HTML 页面，但生成边界受控。

支持 Block：

### MVP

- Text
- Code
- Diagram
- Quiz

### 后续

- Formula
- Table
- Flashcard
- Timeline
- Simulation
- Interactive Chart
- Notebook Cell
- Coding Exercise

AI 可以：

```text
insert
update
replace
remove
move
```

页面中的 Block。

因此用户能够真正看到：

> AI 正在实时修改自己的学习环境。

---

# 6. 学习节点完成机制

OpenTutor 不使用：

> 点击“下一关”即完成。

而使用认知评估。

一个知识点可能经历：

```text
unknown
  ↓
learning
  ↓
weak
  ↓
mastered
```

系统综合：

- 用户回答
- Quiz
- 解释能力
- 应用能力
- 后续表现

更新知识状态。

用户界面不强调算法数值，而使用：

```text
Mastered
Partially understood
Needs review
```

---

# 7. 动态前置知识

例如正在学习：

```text
Self Attention
```

用户：

> Softmax 是什么？

Tutor 判断：

```text
Softmax = unknown prerequisite
```

则创建：

```text
Quick Detour

Softmax
```

路径：

```text
Self Attention
     ↓
Softmax
     ↓
Resume Self Attention
```

完成后自动返回主线。

---

# 8. Side Note 与 Detour

必须区分：

### Main Path

完成课程目标必须学习。

### Detour

由于知识缺口临时插入的前置知识。

### Side Note

用户感兴趣、但不是完成目标所必需。

例如：

> Transformer 和 CNN 有什么区别？

可以插入 Side Note，但不改变主路线。

---

# 9. Course 创建

用户不填写复杂课程表单。

主要入口：

```text
What do you want to learn?

“我要系统学习 Transformer，
最后能够理解 GPT 的结构和基本实现。”
```

可选信息：

- 学习深度
- Deadline
- 已有资料
- 每日可用时间

系统完成：

```text
Goal Analysis
      ↓
Knowledge Retrieval
      ↓
Course Graph
      ↓
Initial Learning Path
      ↓
First Lesson
```

---

# 10. Home

首页只解决三个问题：

### Continue Learning

当前课程 / 当前知识节点。

### Today

今天应该学习或复习什么。

### Needs Attention

当前主要薄弱知识。

避免重新回到大量 Dashboard Card 的设计。

---

# 11. Courses

Courses 是清晰的学习空间列表：

```text
Transformer                   42%
Current: Multi-Head Attention

CSAPP                         68%
Current: Virtual Memory

Linear Algebra                31%
Current: Eigenvectors
```

课程点击后进入 Course Space。

---

# 12. Course Space

Course Space 负责课程整体信息：

```text
Transformer

42% completed

Current
Multi-Head Attention

Current Path
Embedding ✓
Attention ✓
Multi-Head Attention ●
Transformer Block ○
GPT ○

[Continue Learning]
```

Tabs：

```text
Overview
Map
Materials
```

不承担具体教学。

---

# 13. Course Map

课程知识图谱展示：

- 知识关系
- 当前学习路线
- 用户掌握状态
- 前置依赖

用户可点击任意节点查看：

```text
Multi-Head Attention

Status
Learning

Prerequisites
✓ Self Attention
△ Matrix Multiplication

Lessons
2 / 3
```

---

# 14. Global Knowledge

第二阶段提供全局知识图谱：

```text
Math
 ↓
Matrix Multiplication
 ↓
Attention ───── CS336
 ↓
Transformer
 ↓
GPT
```

作用：

- 跨课程查看知识
- 发现课程关联
- 复用知识状态
- 推荐新的学习方向

它不是 MVP 的核心入口。

---

# 15. Library

Library 管理用户资料：

```text
Transformer
├── Attention Is All You Need.pdf
├── CS336 Slides.pdf
└── Notes.md
```

上传后不是简单建立 Vector Index，而是进入 Knowledge Compiler。

页面显示：

```text
Parsing              ✓
Analyzing             ✓
Resolving concepts    ●
Compiling knowledge   ○
Verifying             ○
Indexing              ○
```

处理完成后可以显示：

> Added 12 concepts  
> Updated 5 knowledge artifacts  
> Found 2 possible conflicts

---

# 16. Living Knowledge

用户资料最终形成长期知识：

```text
Document
 ↓
Claim / Evidence
 ↓
Knowledge Artifact
 ↓
Knowledge Graph
```

例如多个来源：

```text
Attention Is All You Need
CS336
User Notes
```

共同维护：

```text
Self Attention

Definition
Intuition
Mechanism
Formula
Prerequisites
Misconceptions
Sources
```

Tutor 优先读取这一编译结果，而不是每次重新阅读所有 Chunk。

---

# 17. Agentic Retrieval

当用户问题超出已有 Artifact 或需要原文证据时：

```text
Question
 ↓
Search knowledge
 ↓
Read artifact
 ↓
Evidence sufficient?
 ├─ yes → Teach
 └─ no
      ↓
   Search source
      ↓
   Read source
      ↓
   Traverse graph if required
      ↓
   Verify
```

因此 Agentic RAG 是 OpenTutor 的**检索子系统**，而不是整个产品本身。

---

# 18. User Profile

用户画像只保存真正影响教学的信息：

```text
preferred depth
preferred teaching style
pace
learning goals
stable preferences
recurring difficulty patterns
```

不直接把所有聊天内容视为用户画像。

---

# 19. 核心用户流程

## 新建课程

```text
描述目标
 ↓
生成课程图谱
 ↓
必要时 Probe
 ↓
生成路径
 ↓
进入 Learning Room
```

## 日常学习

```text
Continue
 ↓
Current Lesson
 ↓
互动 / 提问
 ↓
Quiz
 ↓
更新知识状态
 ↓
下一节点
```

## 上传资料

```text
Upload
 ↓
Knowledge Compiler
 ↓
Living Knowledge
 ↓
Course Impact
```

## 考试模式

原 exam-killer 能力融合为 Assessment / Exam Mode：

```text
课程资料
+
考试范围
+
用户薄弱点
 ↓
高优先级知识
 ↓
训练路径
 ↓
模拟题
 ↓
错题诊断
```

不再作为独立产品存在。

---

# 20. MVP

第一阶段只验证最核心闭环。

### 必须完成

- Web
- 创建 Course
- Course Graph
- Learning Path
- Learning Room
- Tutor
- Text / Code / Diagram / Quiz
- Lesson Patch
- Dynamic prerequisite
- Knowledge State
- PDF / Markdown ingestion
- Basic Knowledge Artifact
- Knowledge Search
- Source Search

### 暂缓

- 视频
- OCR
- 复杂 PPT 图表
- 3D
- 多人协作
- 社交
- 完整 Global Graph UI
- 自动网络研究
- 深层 Knowledge Lint
- 任意 HTML / JS
- 多自治 Agent

---

# 21. 产品成功标准

MVP 首先验证三个问题：

### Learning Continuity

系统是否能够正确记住用户已经掌握和没有掌握的内容。

### Adaptive Teaching

用户提出：

> 简单一点 / 用代码 / 我不会这个

之后，当前课程是否真正发生结构变化。

### Knowledge Reuse

同一知识是否可以：

- 被多个文档支撑
- 被多个课程引用
- 只维护一份用户掌握状态

如果这三项成立，OpenTutor 的核心产品假设成立。

---

# 22. 产品核心差异

普通 AI Tutor：

```text
Question
 ↓
Answer
```

OpenTutor：

```text
Goal
 ↓
Knowledge
 ↓
User State
 ↓
Learning Plan
 ↓
Dynamic Lesson
 ↓
Assessment
 ↓
State Update
 ↓
Replanning
```

因此 OpenTutor 的核心不是“更会回答问题的 LLM”，而是：

> **一个能够持续编译知识、理解用户，并实时编译学习过程的 AI Tutor Runtime。**