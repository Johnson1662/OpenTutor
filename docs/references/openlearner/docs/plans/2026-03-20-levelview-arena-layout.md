# LevelView Arena Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the lesson page into a more immersive arena-style level experience without changing lesson data flow or backend APIs.

**Architecture:** Keep the existing `LevelView` state machine, answer handling, and API calls intact, but reorganize presentation into a status header, arena stage, contextual side panels, and stronger action/feedback zones. Preserve existing step normalization and completion flow so the redesign stays low-risk.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS, Framer Motion

---

### Task 1: Refactor arena shell in `LevelView`

**Files:**
- Modify: `src/components/learning/LevelView.tsx`

**Step 1:** Keep current loading, retry, answer, and completion logic unchanged.

**Step 2:** Replace the current flat page layout with a three-part arena shell:

```tsx
<div className="min-h-screen bg-[...]">
  <header>{/* sticky level status */}</header>
  <main>{/* arena content grid */}</main>
  <footer>{/* sticky actions */}</footer>
</div>
```

**Step 3:** Add small derived labels for the current step type, progress count, and current mode.

**Step 4:** Ensure mobile keeps a single-column layout and desktop upgrades to a split layout.

**Step 5:** Validate TypeScript and rendering by running build.

### Task 2: Redesign the level header as a status bar

**Files:**
- Modify: `src/components/learning/LevelView.tsx`

**Step 1:** Convert the header into a compact mission/status bar with:
- exit button
- level title
- step badge (`Step X of Y`)
- progress rail
- XP counter

**Step 2:** Add stronger visual hierarchy with rounded white container, subtle border, and colored accents.

**Step 3:** Animate progress fill and step badge changes with existing Framer Motion patterns.

### Task 3: Create the arena stage for lesson content

**Files:**
- Modify: `src/components/learning/LevelView.tsx`

**Step 1:** Build a central “stage” card for the current step.

**Step 2:** Add supporting side panels / top strips for:
- current step type
- learning goal / pace cue
- progress mini-map or checkpoint dots

**Step 3:** Render `info`, `multiple_choice`, and `segmenter` inside a shared stage container so all step types feel like one system.

**Step 4:** Improve spacing and max-width so long content reads comfortably.

### Task 4: Upgrade choice cards and answer feedback feel

**Files:**
- Modify: `src/components/learning/LevelView.tsx`
- Review only if needed: `src/components/interactions/FeedbackPanel.tsx`

**Step 1:** Restyle choice cards to feel more tactile and game-like while preserving current correctness logic.

**Step 2:** Make selected, correct, and incorrect states more legible with stronger structure, not just color.

**Step 3:** Keep the current feedback flow, but visually integrate result state with the arena action zone.

### Task 5: Refine sticky footer actions

**Files:**
- Modify: `src/components/learning/LevelView.tsx`

**Step 1:** Turn the footer into a stable action dock.

**Step 2:** Keep `Back` and `Check/Continue`, but make primary action more prominent and context-aware.

**Step 3:** Add small helper text when actions are disabled or when user is on an information step.

### Task 6: Verify build and startup

**Files:**
- No code changes required if verification passes

**Step 1:** Run `npm run build`

**Step 2:** Run `python start.py`

**Step 3:** If build fails, fix the exact issue and rerun both commands.
