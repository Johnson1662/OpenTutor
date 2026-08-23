# Course Detail Style Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the course detail page so it keeps the current structure and interaction model while matching the warmer, cleaner visual language already used in the rest of the app.

**Architecture:** Limit changes to presentation inside `CourseDetailView` and its local helper components. Keep the existing sidebar, chapter timeline, level path, and callbacks intact, but tune color usage, spacing, borders, shadows, and state styling so the page feels visually consistent with `CourseView` and the refreshed learning surfaces.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS, Framer Motion

---

### Task 1: Unify the page shell and sidebar styling

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Keep the current two-column layout and sticky sidebar behavior unchanged.

**Step 2:** Replace the flat sidebar/background treatment with the same warm light gradients, soft borders, and subtle shadows already used by `CourseView`.

**Step 3:** Restyle the main course info card so its spacing, progress rail, icon tile, and metadata feel closer to the existing course cards.

### Task 2: Soften chapter banners and timeline visuals

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Keep the current chapter banner placement and timeline structure.

**Step 2:** Replace the high-saturation solid chapter fills with softer branded gradients and lighter decorative accents.

**Step 3:** Update the timeline rail and level buttons so completed, active, and locked states are easier to scan while preserving current status logic.

### Task 3: Refine empty and destructive states

**Files:**
- Modify: `src/components/course/CourseDetailView.tsx`

**Step 1:** Restyle the XP card, delete action, tooltip, and empty state so they match the app's current rounded-card system.

**Step 2:** Keep copy and behavior unchanged unless a tiny wording tweak improves consistency.

### Task 4: Verify rendering and startup flow

**Files:**
- No code changes required if verification passes

**Step 1:** Run `npm run build`

**Step 2:** Run `python start.py`

**Step 3:** If verification fails, fix the exact issue and rerun the failing command.
