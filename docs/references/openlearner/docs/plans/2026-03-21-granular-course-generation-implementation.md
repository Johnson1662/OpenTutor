# Granular Course Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade course outline and level content generation so the produced learning path is finer-grained, mastery-oriented, and dynamically adapted to learner profile.

**Architecture:** Extend `backend/modules/services/course_generator.py` to compute a more deliberate chapter/level breakdown and attach richer level metadata. Extend `backend/modules/services/level_generator.py` so levels use interleaved teaching and practice loops instead of only terminal quizzes. Keep current API entry points intact.

**Tech Stack:** Python, FastAPI, existing provider abstraction, pytest

---

### Task 1: Add failing tests for outline granularity behavior

**Files:**
- Create or Modify: `backend/tests/test_course_generator.py`
- Modify: `backend/modules/services/course_generator.py`

**Step 1: Write the failing test**

Add tests that verify learner profile changes the generated outline granularity. At minimum cover:
- beginner + exam/thorough produces more total levels than advanced + interest/fast
- normalized level payload contains richer metadata fields such as `learningObjective`, `coreConcept`, and `relatedConcepts`

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_course_generator.py -v`

Expected: FAIL because current generator does not enforce these behaviors.

**Step 3: Write minimal implementation**

Add helper logic in `course_generator.py` to:
- score desired granularity from foundation / goal / pace / depth / material density
- generate more fine-grained chapter and level counts
- attach richer metadata to generated levels

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_course_generator.py -v`

Expected: PASS.

### Task 2: Strengthen AI outline prompt and normalization

**Files:**
- Modify: `backend/modules/services/course_generator.py`

**Step 1:** Update AI prompt so chapters reflect learning phases and topic clusters, not just arbitrary buckets.

**Step 2:** Require richer level metadata in AI JSON output.

**Step 3:** Normalize missing metadata safely so old/partial responses still work.

**Step 4:** Keep existing return shape backward compatible for current frontend usage.

### Task 3: Add failing tests for interleaved level practice

**Files:**
- Create or Modify: `backend/tests/test_level_generator.py`
- Modify: `backend/modules/services/level_generator.py`

**Step 1: Write the failing test**

Add tests that verify generated steps are no longer limited to terminal practice only. At minimum cover:
- a generated level may contain multiple quiz/check steps
- quizzes can appear before the final step
- normalization preserves ordered interleaving of narrative and quiz steps

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_level_generator.py -v`

Expected: FAIL because current template behavior centers on a single final quiz.

**Step 3: Write minimal implementation**

Refactor `level_generator.py` so level output follows a mastery loop:
- concept introduction
- explanation
- quick check
- distinction / related concept explanation
- application or transfer check
- optional synthesis check

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_level_generator.py -v`

Expected: PASS.

### Task 4: Upgrade AI level prompt for mastery loops

**Files:**
- Modify: `backend/modules/services/level_generator.py`

**Step 1:** Update AI prompt to request one core concept plus 2-3 related concepts.

**Step 2:** Require interleaved practice, not just a final quiz.

**Step 3:** Bias question styles toward discrimination, scenario judgment, error spotting, and transfer.

**Step 4:** Vary expected step count using learner difficulty / depth / feedback context.

### Task 5: Improve template fallback quality

**Files:**
- Modify: `backend/modules/services/course_generator.py`
- Modify: `backend/modules/services/level_generator.py`

**Step 1:** Make template outline generation produce more deliberate chapter phases and finer level breakdown.

**Step 2:** Make template level generation produce interleaved explanation and quiz/check steps.

**Step 3:** Ensure fallback remains deterministic enough for tests and robust when AI output is unavailable.

### Task 6: Verify end-to-end stability

**Files:**
- No code changes if verification passes

**Step 1:** Run `pytest backend/tests/test_course_generator.py -v`

**Step 2:** Run `pytest backend/tests/test_level_generator.py -v`

**Step 3:** Run any broader related backend tests if needed.

**Step 4:** Run `python start.py`

**Step 5:** Fix any regression and rerun the failing command.
