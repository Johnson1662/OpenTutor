# Course Roadmap Distill Design

## Goal
Simplify the course detail page so the user can immediately identify the next lesson and understand the chapter path without competing panels, badges, or decorative noise.

## Core Purpose
The page should accomplish one thing first: help the learner continue the course.

Everything else must support that action rather than compete with it.

## Primary User Goal
Start the next lesson with confidence.

## Complexity Sources In Current UI
- Too many simultaneous emphasis points: sidebar stats, chapter cards, milestone pills, node badges, final trophy
- Excessive visual variation: multiple gradients, shadows, rings, colored chips, and decorative blocks
- Information overload: lessons, progress, XP, chapters, milestones, and destination all ask for attention at once
- Too much containerization: the page reads like a stack of nested cards rather than one clear path
- Redundant signaling: progress and reward cues are repeated in several places

## Chosen Direction
Keep the roadmap metaphor, but remove everything that distracts from the path.

- Keep the page split into a lightweight header rail and a roadmap body
- Reduce the left panel into a simple course header with one primary action
- Keep chapter sections, but flatten their presentation and unify their styling language
- Make lesson nodes simpler, calmer, and more consistent
- Remove secondary celebration elements that compete with the next step

## What Stays
- Course title and short description
- One `Next up` action
- Course progress summary
- Chapter list and lesson path
- Lesson states: completed, current, locked

## What Gets Removed Or Reduced
- Four-tile stat grid
- Large chapter-region atmospherics and strong zone-by-zone color changes
- Milestone callout blocks at the end of each chapter
- Large final trophy destination at the bottom
- Rotating current-node ring and oversized reward emphasis
- Repeated chip labels that restate obvious status

## Simplified Page Structure

### Top / Left Summary Area
Reduce this section to:
- Back button
- Course title and description
- One compact progress line
- One compact `Next up` block with a single primary button
- Delete course action visually separated and muted

This area should no longer feel like a dashboard.

### Main Roadmap Area
The roadmap remains the primary content surface.

- Each chapter becomes a simpler section with title, optional description, and progress text
- Chapter containers should feel lighter and flatter, with less decorative background work
- The path should remain visible, but use a quieter visual rail instead of thick decorative route bands

## Node Simplification Rules

### Completed
- Solid but calm styling
- Check icon is enough; avoid extra badges

### Current
- Slightly larger than other nodes
- One clear visual emphasis only
- Keep `Start lesson` obvious without pulsing or spinning decoration

### Locked
- Muted contrast
- Still clearly part of the sequence

## Visual Simplification Rules
- Use a tighter palette: warm neutral base plus green/blue accents only where needed
- Reduce shadows to one subtle elevation system
- Remove unnecessary borders where spacing can do the job
- Limit typography to a tighter hierarchy and fewer uppercase labels
- Prefer open spacing over extra surfaces

## Interaction Simplification Rules
- One primary CTA on the page: start the next lesson
- Lesson cards remain clickable if available or completed
- Locked lessons remain visible but inert
- No extra reveal patterns beyond lightweight hover feedback

## Content Simplification Rules
- Shorter labels
- Less XP repetition
- Fewer explanatory helper lines
- Keep chapter descriptions only when they add orientation

## Success Criteria
- Users can identify the next action within one glance
- The roadmap still feels like a journey, but no longer feels busy
- The page reads as one coherent flow rather than multiple competing modules
- Mobile layout remains clear without stacked visual clutter

## Out Of Scope
- New backend data
- New navigation patterns
- New animations
- Reworking the study page or home page
