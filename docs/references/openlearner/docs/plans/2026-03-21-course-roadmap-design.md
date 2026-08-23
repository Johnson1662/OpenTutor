# Course Roadmap Design

## Goal
Turn the course detail page into a true learning roadmap so users immediately understand where they are, what is next, and how the full course unfolds.

## Scope
- Only redesign `src/components/course/CourseDetailView.tsx`
- Keep existing course, chapter, and level data contracts
- Keep existing callbacks for back navigation, level selection, and delete course
- Do not redesign `src/components/home/HomeView.tsx`
- Do not redesign `src/components/learning/LevelView.tsx`

## Problem
The current course detail page already has a vertical timeline, but it still reads more like a chapter list with banners than a memorable roadmap. The page does not make the next recommended lesson prominent enough, and the path between lessons is not strong enough to become the main visual metaphor.

## Chosen Direction
Use a warm expedition-map approach for the course detail page.

- Keep the left sidebar as a stable mission panel
- Convert the right content area into a roadmap stage made of chapter regions
- Make the path itself visually obvious, with lesson nodes attached to it
- Emphasize the current playable lesson as the main focal point
- Preserve the product's friendly, light, mature Duolingo-inspired tone

## Alternatives Considered

### 1. Refined vertical timeline
Keep the current structure and only polish spacing, gradients, and node styling.

- Pros: lowest risk, fastest to ship
- Cons: does not fully achieve the "learning roadmap" feeling

### 2. Chapter expedition map
Treat each chapter like a distinct region in a continuous journey.

- Pros: strongest roadmap feeling, supports progress and motivation well
- Cons: more layout and styling work

### 3. Skill tree
Render lessons like a branching graph.

- Pros: strong knowledge-structure metaphor
- Cons: current data is mostly linear, so the UI risks implying fake branching

## Information Architecture

### Left: Mission Panel
The left column stays sticky on desktop and becomes the top panel on mobile.

It contains:
- Back button
- Course icon, title, and description
- Summary stats: chapters, lessons, completed count, total XP, progress bar
- A new `Next Up` section showing the current recommended lesson
- The existing destructive action at the bottom

### Right: Roadmap Stage
The right column becomes the main visual stage.

It contains:
- A vertically scrolling sequence of chapter regions
- Each chapter region with title, short description, chapter progress, and lesson path
- A visible connection between chapter regions so the journey feels continuous
- A finish trophy / certification destination at the bottom

## Component Structure
The redesign should stay within `CourseDetailView.tsx` initially, but be structured as if these internal pieces exist:

- `CourseMissionPanel`
- `CourseRoadmap`
- `RoadmapChapterSection`
- `RoadmapNode`
- `RoadmapPath`

The first implementation can keep these as local helper components unless extraction clearly improves readability.

## Chapter Region Design
Each chapter should feel like a separate area of the same world.

- Use a soft chapter-tinted background region instead of a heavy card wall
- Keep one palette family per chapter, rotating through blue, green, gold, and warm coral accents already present in the app
- Use subtle decorative shapes or terrain-like layers rather than dashboard cards
- Keep text clear and structured so the chapter remains easy to scan

## Path Design
The path is the dominant metaphor and should be visible without feeling noisy.

- Replace the current straight central rail with a more map-like route
- Keep layout practical in CSS by arranging nodes in a controlled left-right rhythm along an implied curved track
- Use connecting rails, soft glow pockets, or region transitions to show continuity
- Ensure the path still reads clearly on narrow screens

## Lesson Node States

### Completed
- High-confidence completed styling
- Filled badge, check icon, and settled visual weight
- Should feel conquered, not simply recolored

### Current
- Largest node on screen within its local group
- Strongest contrast and motion cue
- Show this as the obvious next action

### Locked
- Lower saturation and contrast
- Keep visible position in the route so future content still feels motivating
- Use lock icon and reduced emphasis

## Interaction Rules
- Clicking a completed or current node still enters the level through `onSelectLevel`
- Locked nodes remain disabled
- Hover tooltips stay lightweight and informative
- Avoid heavy modals or interruptive overlays
- Page-load animation should reveal chapter regions and nodes in sequence

## Responsive Behavior

### Desktop
- Keep sticky left mission panel
- Show large roadmap stage on the right
- Allow more dramatic horizontal alternation of nodes

### Mobile
- Stack mission panel above roadmap
- Compress the path into a tighter S-curve
- Keep tap targets large and labels readable

## Content Priorities
The page should communicate in this order:

1. What should I do next?
2. How far through this course am I?
3. How is the course organized?

If any decorative treatment interferes with those three answers, it should be reduced.

## Visual Rules
- Light mode only
- Use existing warm Duolingo-adjacent palette from Tailwind `duo.*` colors
- No neon, no glassmorphism, no dark sci-fi styling
- Prefer soft gradients, rounded geometry, and gentle shadows
- Keep the experience playful enough to feel motivating, but mature enough for general learners

## Data and Logic Constraints
- Reuse `course.chapters` and `course.levels` as-is
- Continue grouping levels by `chapterId`
- Derive summary metrics from existing data in the component
- Derive the `Next Up` lesson from current level statuses without backend changes

## Validation
After implementation:

- Run `python start.py` as required by repository instructions
- Prefer also running `npm run build` if the redesign touches TypeScript structure significantly
- Verify desktop and mobile rendering manually

## Out of Scope For First Pass
- Backend schema changes
- New course-progress APIs
- Automatic scroll-to-current-node behavior
- Search, filters, or branching prerequisite logic
- Home page redesign
- Learning page redesign
