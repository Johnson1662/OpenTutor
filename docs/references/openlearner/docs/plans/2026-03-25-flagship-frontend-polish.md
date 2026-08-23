# Flagship Frontend Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 OpenLearner 做一轮旗舰级前端 polish，统一视觉语言、文案、交互状态、基础无障碍和移动端体验，同时不改变核心业务流程。

**Architecture:** 基于现有 Next.js 前端做渐进式收口，不重构整体页面结构。优先处理全局主题和高可见组件，再补齐按钮、弹层、进度条、动效与响应式细节，最后通过 lint、build 和 `start.py` 验证。

**Tech Stack:** Next.js 14、React 18、TypeScript、Tailwind CSS、Framer Motion、Lucide React

---

### Task 1: 收口全局主题与基础样式

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tailwind.config.ts`
- Reference: `AGENTS.md`

**Step 1: 盘点当前全局 token 与明显冲突项**

- 确认 `src/app/globals.css` 中的 `--primary`、`--muted`、`--color-*`
- 确认 `tailwind.config.ts` 中 `fontFamily` 和 `duo` 颜色映射
- 对照 `AGENTS.md` 中温暖浅色、绿蓝金方向

**Step 2: 调整中性色与品牌色 token**

- 保留浅色基调
- 让中性色略带暖色倾向
- 让主强调色更接近绿色 / 蓝色 / 金色体系
- 避免纯黑、纯灰、紫色主视觉

**Step 3: 收口全局交互样式**

- 为输入框、选择卡、按钮公共态增加更明确的 `focus-visible`
- 减少过强阴影和随机 hover 效果
- 为常见过渡统一更自然的 easing 与时长

**Step 4: 加入 reduced-motion 的全局降级基础**

- 在全局 CSS 中添加 `prefers-reduced-motion` 规则
- 降低全局平滑滚动与持续动画对敏感用户的影响

**Step 5: 验证**

Run: `npm run lint`
Expected: 至少不新增 lint 错误

### Task 2: Polish 首页与导航

**Files:**
- Modify: `src/components/home/HomeView.tsx`
- Modify: `src/components/layout/Navbar.tsx`
- Optional: `src/app/page.tsx`

**Step 1: 收口首页中文文案和模块命名**

- 把英文标题、空状态和操作按钮统一为自然中文
- 删除重复表达，缩短无意义说明

**Step 2: 调整首页卡片与空状态层级**

- 减少模板化卡片观感
- 统一标题、副标题、标签和说明文字的层级
- 优化空状态 CTA 的可点击性与完成度

**Step 3: 修正导航可访问性与交互细节**

- 为用户按钮、移动端菜单按钮添加 `aria-label`
- 确保导航按钮有一致的 hover / focus / active / current 状态
- 调整移动菜单展开过渡，避免直接动画 `height`

**Step 4: 优化移动端密度**

- 缩减首页某些区域在窄屏下的拥挤感
- 确保主要 CTA 与统计信息不因断点隐藏而造成理解断裂

**Step 5: 验证**

Run: `npm run build`
Expected: build 成功

### Task 3: Polish 课程列表与课程详情

**Files:**
- Modify: `src/components/course/CourseView.tsx`
- Modify: `src/components/course/CourseDetailView.tsx`
- Optional: `src/components/course/CourseCard.tsx`

**Step 1: 修复假交互和死控件**

- 让 `View all`、`Create New`、课程卡整体交互变得语义明确
- 不保留“看起来能点但没行为”的元素

**Step 2: 收口课程卡视觉与文案**

- 统一中文标题、副标题、进度文案与 XP 文案
- 调整卡片间距、信息密度和删除按钮呈现

**Step 3: 优化详情页信息层级**

- 让课程简介、进度、状态标签、下一步 CTA 更清晰
- 收口侧栏和主内容的视觉节奏

**Step 4: 补齐进度条语义和按钮状态**

- 为进度区域添加 `progressbar` 语义
- 为删除、返回、进入下一关等按钮补齐状态

**Step 5: 验证**

Run: `npm run lint`
Expected: 无新增 warning；若有旧 warning，记录不扩大范围

### Task 4: Polish 学习流程与反馈体验

**Files:**
- Modify: `src/components/learning/LevelView.tsx`
- Modify: `src/components/interactions/FeedbackPanel.tsx`
- Modify: `src/components/interactions/Segmenter.tsx`
- Modify: `src/components/ui/ProgressBar.tsx`
- Optional: `src/components/learning/LevelNode.tsx`

**Step 1: 统一学习流程中文文案**

- 把 `Step`、`Back`、`Continue`、`Check`、`Start over` 等改成统一中文
- 收口成功 / 失败反馈语气

**Step 2: 补齐学习流程按钮和反馈状态**

- 为返回、检查、继续、重试等控件增加一致状态
- 统一成功 / 错误 / 中性提示的配色和层级

**Step 3: 为学习进度增加语义与减弱动画成本**

- 让 `ProgressBar` 与关卡进度拥有 ARIA 属性
- 减少直接动画 `width` / `height` 的密集使用

**Step 4: 改善交互控件可达性**

- `Segmenter` 的点击分隔区域增加更清晰提示和焦点行为
- `ChoiceCard` 增加更明显的 focus-visible 和 disabled 表达

**Step 5: 验证**

Run: `npm run build`
Expected: build 成功，交互组件无类型错误

### Task 5: Polish 弹层、AI 助手与上传体验

**Files:**
- Modify: `src/components/assistant/AIAssistant.tsx`
- Modify: `src/components/feedback/FeedbackModal.tsx`
- Modify: `src/components/learning/UserFeedbackModal.tsx`
- Modify: `src/components/PDFUploader.tsx`
- Optional: `src/components/course/CourseCreator.tsx`

**Step 1: 收口弹层与助手的中文文案**

- 统一标题、描述、按钮、输入占位语
- 让助手、反馈、上传完成态都更符合中文学习场景

**Step 2: 补齐弹层可访问性**

- 给 dialog 增加 `role`、`aria-modal`、标题关联
- 为关闭按钮、发送按钮等 icon-only 控件补齐标签

**Step 3: 优化移动端尺寸与布局**

- 让 AI 助手和反馈弹层在窄屏下不固定死宽高
- 保证按钮和输入框触控尺寸更合理

**Step 4: 移除 AI 感强的紫色渐变与演示风格**

- 把上传器中的紫色渐变替换为更符合品牌的柔和配色
- 统一上传、处理中、完成状态的视觉语言

**Step 5: 验证**

Run: `npm run lint && npm run build`
Expected: 都成功

### Task 6: 最终联调与验收

**Files:**
- Verify only: `src/app/page.tsx`
- Verify only: `start.py`
- Verify only: `docs/plans/2026-03-25-flagship-frontend-polish-design.md`

**Step 1: 手动走查关键路径**

- 首页 -> 课程列表 -> 课程详情 -> 关卡学习 -> 反馈弹层 -> 助手
- 检查桌面和窄屏下的主要布局

**Step 2: 运行自动验证**

Run: `npm run lint`
Expected: 通过或仅保留既有已知 warning

Run: `npm run build`
Expected: 成功构建

Run: `python start.py`
Expected: 前端启动成功；后端若继续受 Python 3.14 / 缺依赖影响，要在结果中明确记录

**Step 3: 记录残留问题**

- 仅记录未在本轮处理的已知问题
- 不为了“完美”引入大范围结构重构
