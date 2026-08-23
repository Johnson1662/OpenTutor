# 07 — Course Compiler, Detour Replan, and Golden Path E2E

**What to build:** Implement `CourseCompiler` (goal analysis -> prerequisite closure -> topological sort -> initial learning path), embed Socratic skills, implement automatic detour recovery, and deliver the complete Golden Path E2E scenario test.

**Blocked by:** 06 — Assessment Engine and MasteryPolicy

**Status:** ready-for-agent

- [ ] Implement `CourseCompiler` generating course graphs and user-tailored learning paths
- [ ] Connect Socratic teaching skills (`teach`, `probe`, `learn-visual`) to Tutor Agent
- [ ] Implement automatic learning path detour resolution returning learner to main track
- [ ] Implement complete Golden Path E2E scenario test:
  1. Upload Transformer markdown doc
  2. Compile Living Knowledge
  3. Generate Course & Path
  4. Tutor diagnoses Softmax prerequisite gap & inserts Detour
  5. Learner passes Softmax assessment
  6. MasteryPolicy updates state & resumes Self Attention lesson
  7. Verify persistence across simulated server reboot
