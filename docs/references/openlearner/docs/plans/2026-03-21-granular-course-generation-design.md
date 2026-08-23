# Granular Course Generation Design

## Goal
Make generated courses and levels fine-grained enough that a learner who completes the full path can systematically master the chosen topic, instead of only receiving a coarse overview.

## Problem
The current course generator mainly produces chapters and levels from topic groupings, while the level generator mainly produces a few narrative steps plus one quiz at the end. This is enough for lightweight exploration, but not enough for structured mastery.

## Chosen Direction
Rebuild both outline generation and level generation around a mastery-oriented learning path.

- Course outline becomes dynamically granular based on learner profile
- Chapters represent learning phases plus topic clusters, not only material chunks
- Levels become smaller and more deliberate, each centered on one core concept plus a few tightly related supporting concepts
- Exercises are interleaved after explanation blocks instead of being reserved for the final step only

## Outline Design

### Dynamic Granularity
Course size should not be fixed. It should be determined from:
- learner foundation
- learning goal
- learning pace
- requested depth
- material density

General rule:
- weaker foundation -> finer breakdown
- exam / professional goal -> finer breakdown
- slow / thorough pace -> finer breakdown
- advanced foundation or fast pace -> relatively more compact breakdown

### Chapter Design
Chapters should represent learning phases as well as content groupings. Every course should still cover a full path such as:
- orientation and foundational setup
- core concepts and definitions
- mechanisms / models / inner logic
- distinctions / edge cases / misconceptions
- application / transfer / synthesis

The number of chapters and levels can flex, but the learner should experience a complete capability-building arc.

### Level Design Metadata
Each generated level should carry richer semantics so content generation can stay focused.

Recommended fields:
- `learningObjective`
- `coreConcept`
- `relatedConcepts`
- `masteryFocus`
- `estimatedLoad`
- `recommendedStepCount`

Frontend does not need to use all these fields immediately, but generation quality should rely on them.

## Level Content Design

### Core Unit
Each level should revolve around:
- 1 core concept
- 2-3 tightly related concepts

This avoids both extremes:
- a level that is too broad to truly learn
- a level that is too tiny to feel worthwhile

### Step Structure
Levels should no longer default to "several narratives + one final quiz".

Instead, they should follow a small mastery loop with exercises interleaved:
- introduce the focus and why it matters
- explain the core concept
- insert a quick check or discrimination exercise
- explain a related concept / misconception / boundary
- insert another application or comparison exercise
- close with a stronger synthesis check when appropriate

Not every level needs the exact same number of steps, but the structure should favor repeated understanding-check cycles.

### Exercise Types
Exercises should prioritize mastery-oriented checks:
- concept discrimination
- scenario judgment
- error spotting
- simple transfer / application

They should not rely only on recall questions.

### Personalization
Level generation should adapt by learner profile:
- beginner -> more scaffolding, examples, and misconception checks
- exam -> more distinction and high-frequency trap detection
- professional -> more scenario-based reasoning
- fast pace -> fewer but sharper steps
- slow / thorough pace -> more intermediate checks and consolidation

## Fallback Strategy
Template generation should also become more granular.

Even without AI JSON generation, the system should:
- produce more deliberate chapter/level structure
- derive level metadata from extracted keywords
- create interleaved exercise steps instead of a single terminal quiz

## Validation Goals
After implementation, generated output should show:
- more levels than before when learner profile calls for finer study
- clearer learning progression toward mastery
- more focused per-level objectives
- exercises appearing throughout the level, not only at the end
