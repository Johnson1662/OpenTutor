# Course Roadmap Distill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the course detail roadmap so the next lesson and learning path are clearer, calmer, and easier to scan.

**Architecture:** Keep the existing course detail data flow and roadmap structure in `src/components/course/CourseDetailView.tsx`, but reduce visual layers and consolidate hierarchy. Preserve the roadmap summary helper logic and replace decorative UI with a smaller set of reusable visual patterns.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Framer Motion

---

### Task 1: Lock simplification behavior with focused tests

**Files:**
- Modify: `src/components/course/course-roadmap-helpers.test.ts`
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1: Write a failing test**

Add a test that verifies the roadmap summary still identifies only the first `available` lesson as `nextLevel` even after UI simplification work.

**Step 2: Run test to verify it fails if needed**

Run: `npx tsx --test "src/components/course/course-roadmap-helpers.test.ts"`

Expected: Either a failing new assertion before implementation, or existing suite red if the helper was broken.

**Step 3: Write minimal implementation**

Keep `buildRoadmapSummary()` behavior intact while simplifying UI structure.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test "src/components/course/course-roadmap-helpers.test.ts"`

Expected: PASS.

### Task 2: Simplify the summary panel

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Remove the current stat-grid feel from the summary area.

**Step 2:** Reduce the panel to course identity, one compact progress summary, and one `Next up` action block.

**Step 3:** Keep delete-course action visually separated and lower emphasis.

**Step 4:** Avoid nested card-within-card structure where spacing can replace containers.

### Task 3: Flatten chapter presentation

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Reduce chapter-region decoration, gradients, and container weight.

**Step 2:** Keep chapter title, optional description, and progress, but condense their visual treatment.

**Step 3:** Keep the roadmap rail visible while making it quieter and more uniform.

### Task 4: Simplify lesson nodes

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Remove unnecessary badges, rotating decoration, and over-strong emphasis.

**Step 2:** Keep only one clear differentiator for each state: completed, current, locked.

**Step 3:** Reduce XP prominence so it supports the node rather than dominating it.

### Task 5: Remove secondary celebration clutter

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Remove chapter milestone blocks.

**Step 2:** Remove the oversized final trophy section.

**Step 3:** Ensure the page still ends cleanly and the final chapter does not feel abruptly cut off.

### Task 6: Verify simplified hierarchy and responsive scanability

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx` if follow-up fixes are needed

**Step 1:** Confirm there is one obvious primary action.

**Step 2:** Confirm mobile keeps a readable linear flow without stacked card clutter.

**Step 3:** Trim any remaining labels, shadows, or visual treatments that do not justify themselves.

### Task 7: Verify implementation

**Files:**
- No code changes if verification passes

**Step 1:** Run `npx tsx --test "src/components/course/course-roadmap-helpers.test.ts"`

**Step 2:** Run `python start.py`

**Step 3:** If useful after layout changes, run `npm run build`

**Step 4:** Fix any regression and rerun the failing command.
