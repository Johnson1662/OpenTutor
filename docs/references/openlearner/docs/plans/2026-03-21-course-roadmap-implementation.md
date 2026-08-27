# Course Roadmap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the course detail page into a route-first learning roadmap that highlights the next lesson and makes chapter progress feel like a guided journey.

**Architecture:** Keep all existing course detail data flow, callbacks, and backend contracts intact inside `src/components/course/CourseDetailView.tsx`. Replace the current chapter-banner timeline presentation with a mission sidebar plus roadmap stage, using local helper components and derived view state for chapter grouping and the next recommended lesson.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS, Framer Motion

---

### Task 1: Derive roadmap state from existing course data

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Add small derived helpers for:
- chapter-to-level grouping
- completed lesson count
- total XP
- next playable lesson
- per-chapter completion count

**Step 2:** Keep all derivation local to the component and reuse existing `Level.status`, `chapterId`, and `xpReward` fields.

**Step 3:** Avoid introducing new app-level state or API calls.

### Task 2: Turn the sidebar into a mission panel

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Keep the sticky sidebar behavior and back/delete actions.

**Step 2:** Restyle the summary card so it feels like a mission panel rather than a dashboard card.

**Step 3:** Add a `Next Up` section with:
- lesson title
- chapter title
- XP reward
- clear primary button wired to `onSelectLevel`

**Step 4:** Keep destructive UI visually separated from the primary action area.

### Task 3: Replace the straight timeline with roadmap chapter regions

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Replace the current chapter banner plus center rail presentation with chapter regions that feel like map zones.

**Step 2:** Keep chapter title and description visible near the start of each region.

**Step 3:** Add a stronger visual route through each chapter using soft rails, gradients, and alternating node positions.

**Step 4:** Preserve the current chapter ordering exactly.

### Task 4: Redesign lesson nodes around clear progression states

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Restyle lesson nodes so completed, current, and locked states are clearly distinct in size, iconography, contrast, and motion.

**Step 2:** Make the current playable lesson the strongest visual focal point.

**Step 3:** Keep locked lessons disabled and completed/current lessons clickable.

**Step 4:** Keep hover details lightweight and avoid modals.

### Task 5: Add chapter milestone and end-state cues

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Add a small milestone treatment at the end of each chapter or at least a clearer chapter completion cue.

**Step 2:** Keep the final trophy destination at the bottom, but update styling to match the roadmap language.

**Step 3:** Ensure decorative elements do not obscure labels or click targets.

### Task 6: Verify responsive behavior and visual hierarchy

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx` if fixes are needed

**Step 1:** Confirm desktop preserves two-column layout with sticky sidebar.

**Step 2:** Confirm mobile collapses to stacked layout with readable labels and large tap targets.

**Step 3:** Trim any decoration that hurts scanability or makes the next lesson less obvious.

### Task 7: Verify build and startup flow

**Files:**
- No code changes required if verification passes

**Step 1:** Run `npm run build`

**Step 2:** Run `python start.py`

**Step 3:** If either command fails, fix the exact issue and rerun the failing command.
