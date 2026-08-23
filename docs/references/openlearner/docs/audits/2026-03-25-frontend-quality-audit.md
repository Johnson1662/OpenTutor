# OpenLearner Frontend Quality Audit

日期：2026-03-25  
范围：`src/app/`、`src/components/`、`src/lib/`、`src/app/globals.css`、`tailwind.config.ts`、`.github/copilot-instructions.md`

## Anti-Patterns Verdict

结论：**Fail - 当前界面有明显 AI 生成感。**

主要信号：

- **通用字体与冷淡极简主题**：`src/app/globals.css:67` 与 `tailwind.config.ts:11` 到 `tailwind.config.ts:13` 仍使用 `-apple-system` / `Inter` / `Roboto` 这一类高频默认栈，和仓库要求的“温暖、清晰、邀请式”不一致。
- **重复卡片化布局**：`src/components/home/HomeView.tsx:36`、`src/components/home/HomeView.tsx:107`、`src/components/home/HomeView.tsx:171`、`src/components/course/CourseView.tsx:63` 都在重复“卡片 + 边框 + 阴影 + 小标签”的安全模板。
- **硬编码紫色渐变与演示风格失真**：`src/components/PDFUploader.tsx:70`、`src/components/PDFUploader.tsx:102`、`src/components/PDFUploader.tsx:148` 使用典型 AI 风格紫色渐变，与仓库设计指引偏好的柔和绿 / 蓝 / 金不一致。
- **玻璃态/模糊被装饰性使用**：`src/components/layout/Navbar.tsx:29`、`src/components/feedback/FeedbackModal.tsx:24`、`src/components/learning/UserFeedbackModal.tsx:57` 使用 `backdrop-blur`，但没有明显信息层级收益。
- **死控件与假交互**：`src/components/course/CourseView.tsx:53` 的 `View all` 没行为，`src/components/course/CourseView.tsx:107` 到 `src/components/course/CourseView.tsx:116` 的 `Create New` 卡片看起来可点但没有 `onClick`。
- **语言风格拼接感强**：中文产品里混入大量英文核心文案，如 `src/components/home/HomeView.tsx:99`、`src/components/course/CourseView.tsx:35`、`src/components/feedback/FeedbackModal.tsx:51`、`src/components/assistant/AIAssistant.tsx:170`。

## Executive Summary

- 总问题数：**15**
- 严重级别分布：**Critical 3 / High 5 / Medium 4 / Low 3**
- 最关键问题：
  1. 模态与弹层普遍缺少对话框语义、焦点管理与键盘退出
  2. 多处关键交互不是语义化按钮，且存在“看起来可点但不工作”的控件
  3. 整站缺少 reduced-motion 策略，但页面动画密度高且存在无限循环
  4. 主题 token 没有被系统执行，硬编码颜色和旧风格混用
  5. 响应式适配不稳定，移动端存在拥挤网格和固定尺寸弹层风险
- 整体质量评分：**61 / 100**
- 推荐下一步：先解决 `Critical` 的无障碍与交互问题，再做主题归一和性能清理，最后收口文案与版式细节。

## Detailed Findings by Severity

### Critical Issues

#### 1. 模态缺少对话框语义、焦点管理与 Esc 退出
- **Location**: `src/components/feedback/FeedbackModal.tsx:19`, `src/components/feedback/FeedbackModal.tsx:28`, `src/components/learning/UserFeedbackModal.tsx:51`, `src/components/learning/UserFeedbackModal.tsx:59`, `src/components/course/CourseCreator.tsx:503`, `src/components/assistant/AIAssistant.tsx:78`
- **Severity**: Critical
- **Category**: Accessibility
- **Description**: 遮罩和弹层都有视觉样式，但缺少 `role="dialog"`、`aria-modal="true"`、标题关联、初始焦点、焦点陷阱和 Esc 关闭。
- **Impact**: 键盘用户和读屏用户难以判断自己是否进入弹层，也可能失去焦点位置，影响关闭和继续操作。
- **WCAG/Standard**: WCAG 2.1 A / 2.4.3 Focus Order / 4.1.2 Name, Role, Value
- **Recommendation**: 给所有弹层增加标准 dialog 语义、标题描述、焦点进入/返回、Esc 关闭和背景内容 inert 处理。
- **Suggested command**: `/harden`

#### 2. 多处伪按钮/死控件导致键盘不可达或交互失效
- **Location**: `src/components/home/HomeView.tsx:152`, `src/components/course/CourseView.tsx:58`, `src/components/course/CourseView.tsx:53`, `src/components/course/CourseView.tsx:107`, `src/components/home/HomeView.tsx:78`, `src/components/home/HomeView.tsx:84`
- **Severity**: Critical
- **Category**: Accessibility
- **Description**: 使用 `div` / `motion.div` 绑定 `onClick`，或者渲染“按钮样式”却没有行为。
- **Impact**: 键盘用户无法操作，鼠标用户也会遇到“看起来能点但点了没反应”的严重信任问题。
- **WCAG/Standard**: WCAG 2.1 A / 2.1.1 Keyboard / 4.1.2 Name, Role, Value
- **Recommendation**: 所有交互改为真实 `button` / `a` 元素；移除无行为按钮，或补齐处理函数和禁用态说明。
- **Suggested command**: `/harden`

#### 3. 缺少 reduced-motion 策略，且存在无限动画
- **Location**: `src/components/ui/LoadingState.tsx:33`, `src/components/layout/LoadingScreen.tsx:17`, `src/components/assistant/AIAssistant.tsx:134`, `src/components/learning/LevelView.tsx:313`, `src/components/course/CourseView.tsx:96`
- **Severity**: Critical
- **Category**: Accessibility
- **Description**: 未发现 `prefers-reduced-motion` 或 `useReducedMotion` 处理，同时存在无限旋转、循环脉冲和多处动画进度条。
- **Impact**: 对前庭敏感用户不友好，严重时会触发眩晕或不适，也增加持续渲染负担。
- **WCAG/Standard**: WCAG 2.3.3 Animation from Interactions / 2.2.2 Pause, Stop, Hide
- **Recommendation**: 为所有动画统一接入 reduced-motion 分支，关闭非必要循环动画，保留状态表达最小集合。
- **Suggested command**: `/animate`

### High-Severity Issues

#### 4. 多个图标按钮没有可访问名称
- **Location**: `src/components/layout/Navbar.tsx:73`, `src/components/layout/Navbar.tsx:77`, `src/components/assistant/AIAssistant.tsx:67`, `src/components/assistant/AIAssistant.tsx:96`, `src/components/assistant/AIAssistant.tsx:173`, `src/components/learning/LevelView.tsx:304`, `src/components/learning/UserFeedbackModal.tsx:73`, `src/components/course/CourseCreator.tsx:523`
- **Severity**: High
- **Category**: Accessibility
- **Description**: 多个仅图标按钮没有 `aria-label` 或可见文本。
- **Impact**: 读屏器只能读出“button”，用户无法知道其用途。
- **WCAG/Standard**: WCAG 2.1 A / 4.1.2 Name, Role, Value
- **Recommendation**: 所有 icon-only 按钮补齐可访问名称，必要时加 tooltip 或隐藏文本。
- **Suggested command**: `/harden`

#### 5. 进度条只有视觉，没有进度语义
- **Location**: `src/components/ui/ProgressBar.tsx:21`, `src/components/learning/LevelView.tsx:312`, `src/components/course/CourseView.tsx:95`, `src/components/course/CourseDetailView.tsx:171`, `src/components/course/CourseDetailView.tsx:234`
- **Severity**: High
- **Category**: Accessibility
- **Description**: 进度表现仅通过宽度动画展示，没有 `role="progressbar"`、`aria-valuemin`、`aria-valuenow`、`aria-valuemax`。
- **Impact**: 屏幕阅读器无法获取课程或关卡进度，核心学习状态对一部分用户不可见。
- **WCAG/Standard**: WCAG 2.1 A / 4.1.2 Name, Role, Value
- **Recommendation**: 为统一进度组件补充 ARIA 语义，并确保文本百分比与视觉同步。
- **Suggested command**: `/harden`

#### 6. 主题系统执行不一致，硬编码颜色广泛绕过 token
- **Location**: `src/app/globals.css:15`, `src/app/globals.css:41`, `src/components/PDFUploader.tsx:70`, `src/components/PDFUploader.tsx:102`, `src/components/home/HomeView.tsx:39`, `src/components/feedback/FeedbackModal.tsx:45`, `src/components/interactions/FeedbackPanel.tsx:37`, `src/components/providers/LessonCard.tsx:60`
- **Severity**: High
- **Category**: Theming
- **Description**: 设计 token 存在，但多个组件直接写死橙、绿、红、紫色和渐变；另有旧 Apple-like 中性色主题与产品设计指引冲突。
- **Impact**: 界面难以保持统一品牌感，后续主题切换或视觉升级成本会越来越高。
- **WCAG/Standard**: Design system consistency / theming integrity
- **Recommendation**: 把状态色、品牌色、强调色全部收敛到 token 层，移除组件内的 ad-hoc 颜色与渐变。
- **Suggested command**: `/normalize`

#### 7. 窄屏响应式存在实际风险：固定面板、拥挤网格、横向列表
- **Location**: `src/components/assistant/AIAssistant.tsx:83`, `src/components/home/HomeView.tsx:166`, `src/components/course/CourseView.tsx:56`, `src/components/course/CourseView.tsx:63`, `src/components/course/CourseDetailView.tsx:200`
- **Severity**: High
- **Category**: Responsive
- **Description**: 助手弹层固定 `w-80 h-[450px]`；首页课程网格在最小断点即两列；课程列表依赖横向滚动卡片；详情页侧栏在特定尺寸下容易压缩主内容。
- **Impact**: 小屏设备上内容拥挤、可读性差，部分交互需要横向滚动才能完成。
- **WCAG/Standard**: WCAG 1.4.10 Reflow
- **Recommendation**: 为移动端单独设计布局，而不是仅缩小桌面样式；使用容器查询或移动优先断点。
- **Suggested command**: `/arrange`

#### 8. 文案语言混用，破坏产品一致性与可信度
- **Location**: `src/components/home/HomeView.tsx:44`, `src/components/home/HomeView.tsx:52`, `src/components/home/HomeView.tsx:99`, `src/components/course/CourseView.tsx:35`, `src/components/feedback/FeedbackModal.tsx:51`, `src/components/learning/UserFeedbackModal.tsx:68`, `src/components/assistant/AIAssistant.tsx:170`
- **Severity**: High
- **Category**: Theming
- **Description**: 页面以中文为主，但多个关键按钮、状态、标题和占位文案仍是英文。
- **Impact**: 降低产品完成度感，也让学习场景显得像拼接出来的原型而不是统一体验。
- **WCAG/Standard**: UX writing consistency / localization quality
- **Recommendation**: 定义中文优先的文案规范，统一 CTA、状态、提示语和占位文案。
- **Suggested command**: `/clarify`

### Medium-Severity Issues

#### 9. 多处动画直接操作 `width` / `height`
- **Location**: `src/components/course/CourseDetailView.tsx:172`, `src/components/course/CourseDetailView.tsx:237`, `src/components/learning/LevelView.tsx:316`, `src/components/ui/ProgressBar.tsx:25`, `src/components/layout/Navbar.tsx:89`, `src/components/interactions/FeedbackPanel.tsx:114`, `src/components/PDFUploader.tsx:146`, `src/components/layout/LoadingScreen.tsx:63`
- **Severity**: Medium
- **Category**: Performance
- **Description**: 多个组件使用 Framer Motion 或普通样式动画直接驱动 `width` / `height`。
- **Impact**: 在低端设备上更容易触发布局和重绘开销，尤其是列表和全屏过渡同时发生时。
- **WCAG/Standard**: Rendering performance best practice
- **Recommendation**: 进度条改为 transform 技术或仅在必要处更新；高度展开改用 `grid-template-rows` 等更稳定模式。
- **Suggested command**: `/optimize`

#### 10. 两个 Hook 依赖问题已被 lint 明确指出
- **Location**: `src/components/learning/LevelView.tsx:199`, `src/components/PDFUploader.tsx:35`
- **Severity**: Medium
- **Category**: Performance
- **Description**: `npm run lint` 和 `npm run build` 均报告 Hook 依赖缺失警告。
- **Impact**: 容易造成状态闭包过期、重试逻辑不稳定或未来重构后出现隐藏 bug。
- **WCAG/Standard**: React hooks correctness
- **Recommendation**: 修正依赖数组或重构回调定义，确保副作用触发条件可预测。
- **Suggested command**: `/harden`

#### 11. KaTeX 样式重复引入且其中一次依赖 CDN
- **Location**: `src/app/layout.tsx:3`, `src/app/globals.css:5`
- **Severity**: Medium
- **Category**: Performance
- **Description**: 同时引入本地 `katex/dist/katex.min.css` 与 CDN `@import`。
- **Impact**: 造成额外样式负担和外部网络依赖，也增加样式来源不一致风险。
- **WCAG/Standard**: Asset loading efficiency
- **Recommendation**: 保留单一、可控的本地引入方式，删除 CDN `@import`。
- **Suggested command**: `/optimize`

#### 12. 单页状态机过大，首页首包偏重
- **Location**: `src/app/page.tsx:25`
- **Severity**: Medium
- **Category**: Performance
- **Description**: 主页面承担 home / courses / detail / learning / creator / feedback / assistant 多视图切换，构建输出显示 `/` 首次加载 JS 为 225kB。
- **Impact**: 首屏加载和交互响应压力集中在单一路由，后续继续堆功能会更难维护。
- **WCAG/Standard**: Bundle size and maintainability best practice
- **Recommendation**: 逐步拆分路由、视图边界和懒加载粒度，减少首页承载的所有状态。
- **Suggested command**: `/extract`

### Low-Severity Issues

#### 13. 过多 9-11px 全大写标签影响可读性
- **Location**: `src/components/home/HomeView.tsx:44`, `src/components/home/HomeView.tsx:65`, `src/components/course/CourseDetailView.tsx:133`, `src/components/course/CourseDetailView.tsx:170`, `src/components/course/CourseView.tsx:89`, `src/components/learning/UserFeedbackModal.tsx:106`
- **Severity**: Low
- **Category**: Accessibility
- **Description**: 小字号、全大写、宽字距标签在多个界面重复出现。
- **Impact**: 对低视力用户和移动端阅读都不够友好，学习场景会显得更紧绷。
- **WCAG/Standard**: Readability best practice / WCAG AAA direction
- **Recommendation**: 减少全大写，改进字重和字号层级，让状态信息更像辅助信息而不是视觉噪声。
- **Suggested command**: `/typeset`

#### 14. 触控目标在若干位置低于推荐 44x44
- **Location**: `src/components/course/CourseView.tsx:72`, `src/components/layout/Navbar.tsx:73`, `src/components/layout/Navbar.tsx:77`, `src/components/learning/LevelView.tsx:387`, `src/components/interactions/Segmenter.tsx:71`
- **Severity**: Low
- **Category**: Responsive
- **Description**: 删除按钮、用户按钮、菜单按钮、重置按钮和分词点击区尺寸偏小。
- **Impact**: 手机或平板上更容易误触，尤其在学习流程需要持续高频操作时会增加摩擦。
- **WCAG/Standard**: WCAG 2.5.5 Target Size (AAA)
- **Recommendation**: 将关键触控目标统一提升到至少 44x44 或提供更大可点击区域。
- **Suggested command**: `/arrange`

#### 15. 使用系统默认确认框和告警，打断整体体验
- **Location**: `src/app/page.tsx:179`, `src/app/page.tsx:191`, `src/components/course/CourseView.tsx:68`
- **Severity**: Low
- **Category**: Theming
- **Description**: 删除和失败反馈使用 `window.confirm` / `alert`。
- **Impact**: 交互风格跳出产品语境，也不利于统一可访问文案和按钮层级。
- **WCAG/Standard**: UX consistency
- **Recommendation**: 用系统内确认组件替换原生阻塞式弹窗。
- **Suggested command**: `/polish`

## Patterns & Systemic Issues

- **硬编码颜色广泛存在**：状态色、品牌色和演示色散落在 10+ 组件中，token 存在但没有成为执行标准。
- **自定义交互缺少无障碍补齐**：一旦不是原生表单或原生按钮，通常就缺少语义、键盘处理或名称。
- **动画默认开启且没有降级方案**：页面把“会动”当作默认状态，而不是一种可降级增强。
- **产品语言未收口**：中文、英文、演示态文案和系统提示混在一起，削弱品牌成熟度。
- **卡片化布局泛滥**：多个页面都依赖“边框卡片 + 阴影 + 小标签”模板，视觉层级趋于扁平和同质化。

## Positive Findings

- `src/app/layout.tsx:29` 已正确设置 `lang="zh-CN"`。
- `src/app/globals.css:7` 到 `src/app/globals.css:61` 与 `tailwind.config.ts:14` 到 `tailwind.config.ts:85` 已有较完整的 token 与 Tailwind 映射基础，说明主题重构有落点。
- `src/components/home/HomeView.tsx:31`、`src/components/home/HomeView.tsx:108`、`src/components/layout/Navbar.tsx:44` 已经开始处理不同断点，而不是完全无响应式意识。
- `npm run build` 通过，说明当前实现虽有质量问题，但没有明显的构建级阻塞。
- `src/components/course/CourseDetailView.tsx:54` 的 `buildRoadmapSummary` 数据整形比较清晰，后续适合继续抽成更稳的展示层。

## Recommendations by Priority

1. **Immediate**
   - 修复所有 dialog / modal 的无障碍基础设施
   - 替换伪按钮、死控件和不可键盘操作的交互表面
   - 为全站动画增加 reduced-motion 降级

2. **Short-term**
   - 为 icon-only 按钮补齐可访问名称
   - 为进度条统一增加 ARIA 语义
   - 清理硬编码颜色，建立品牌色与状态色 token 约束
   - 修复移动端固定尺寸弹层和拥挤网格

3. **Medium-term**
   - 优化 width / height 动画和重复资源引入
   - 解决 Hook 依赖警告
   - 拆分首页巨型客户端状态机，降低首包复杂度

4. **Long-term**
   - 收口中文文案体系
   - 降低卡片模板重复率，建立更有层级的页面结构
   - 优化字号系统与触控尺寸，提升长时学习舒适度

## Suggested Commands for Fixes

- 使用 `/harden` 修复 dialog、按钮语义、进度条 ARIA、Hook 依赖和边缘状态问题（覆盖 6 个问题）
- 使用 `/normalize` 统一设计 token、颜色和组件状态表达（覆盖 3 个问题）
- 使用 `/arrange` 调整移动端布局、触控尺寸和窄屏信息密度（覆盖 2 个问题）
- 使用 `/optimize` 清理动画方式、重复样式引入和包体负担（覆盖 3 个问题）
- 使用 `/clarify` 统一中文文案与状态提示（覆盖 1 个问题）
- 使用 `/typeset` 收敛全大写小标签和文字层级（覆盖 1 个问题）
- 使用 `/polish` 替换原生 `confirm` / `alert` 并做视觉收尾（覆盖 1 个问题）
