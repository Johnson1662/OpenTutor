# OpenTutor 参考文档与架构索引

本目录收录了 OpenTutor 项目的顶层架构设计、原型讨论与融合参考子项目的核心技术资产。

---

## 目录结构

```
docs/
├── README.md                                  # 本文档：文档总索引
├── OPENTUTOR_ARCHITECTURE.md                  # OpenTutor 顶层系统架构与协议规范
├── architecture/
│   └── MVP_ARCHITECTURE_DISCUSSION.md         # 原始需求与 MVP 架构讨论记录
└── references/                                # 核心参考项目与子模块资产
    ├── alvar-method/                          # teach.zip：Alvar 认知教学法全套资产
    │   ├── probe/                             # 掌握度边界二分探测技能
    │   ├── teach/                             # 核心教学循环（DAG规划、单步教学、Lock-in）
    │   ├── learn-visual/                      # 一图一主张 SVG 教学图解
    │   ├── learn-verify/                      # 教学事实与定理核验
    │   └── learn-profile/                     # 学习者画像与偏好建立
    ├── exam-killer/                           # exam-killer：材料解析与题库抽取资产
    │   ├── PRODUCT.md                         # 产品定义与设计哲学
    │   ├── DESIGN.md                          # UI/UX 视觉规范
    │   ├── exam-killer-plan.md                # 架构设计（MinerU SDK、SQLite、SSE、Agent）
    │   └── prompts/                           # 题目抽取、PPT/教材拆分与 Wiki 提示词
    └── openlearner/                           # openlearner：交互学习平台与 RAG 资产
        ├── types.ts                           # 核心前端数据模型与交互类型定义
        └── docs/                              # 路线图设计、RAG 迁移、组件优化等设计方案
```

---

## 核心文档导读

1. **[系统架构与协议规范 (OPENTUTOR_ARCHITECTURE.md)](OPENTUTOR_ARCHITECTURE.md)**  
   规定了 OpenTutor 的整体分层、`LessonSchema` 协议、Alvar 教学循环和跨端适配路线。

2. **[MVP 架构讨论记录 (architecture/MVP_ARCHITECTURE_DISCUSSION.md)](architecture/MVP_ARCHITECTURE_DISCUSSION.md)**  
   记录了从传统课程列表向 AI 原生自适应画布演进的思考、ArkWeb 混合方案以及 Lesson Block 构想。

3. **[Alvar 教学法参考 (references/alvar-method/)](references/alvar-method/)**  
   包含 Probe（探测）、Mermaid 依赖图、单步推理、Quiz UI 约束及 Learner Profile 配置。

4. **[Exam-Killer 知识萃取参考 (references/exam-killer/)](references/exam-killer/)**  
   提供基于 MinerU 的 PDF/PPT 结构化解析能力与题库生成方案。

5. **[OpenLearner 交互组件与 RAG 参考 (references/openlearner/)](references/openlearner/)**  
   提供前端多类型交互组件、关卡状态机及 LangChain + Chroma RAG 架构设计。
