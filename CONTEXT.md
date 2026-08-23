# OpenTutor Domain Context

OpenTutor is an AI-native personalized adaptive learning system that continuously assesses user knowledge state and dynamically generates and patches structured lessons.

## Language

### Knowledge Domain

**Knowledge Node**:
A canonical, shared entity representing a single learnable concept or skill in the global knowledge graph.
_Avoid_: Concept, topic, tag, entity

**Knowledge Edge**:
A semantic relationship between two Knowledge Nodes representing prerequisite, hierarchy, or conceptual connection.
_Avoid_: Link, connection, dependency

**User Knowledge State**:
The assessed proficiency level and confidence of a specific user on a specific Knowledge Node.
_Avoid_: User score, mastery level, grade

**Knowledge Artifact**:
A synthesized, structured living compilation of all verified claims and evidence about a Knowledge Node.
_Avoid_: Wiki page, note, summary, document

---

### Course Domain

**Course**:
A user-facing learning objective and its pedagogical projection of knowledge nodes.
_Avoid_: Class, syllabus, curriculum, module

**Course Graph**:
The pedagogical graph defining how knowledge nodes are organized and sequenced for a specific course.
_Avoid_: Course outline, lesson tree, table of contents

---

### Learning Domain

**Learning Path**:
The dynamic, personalized sequence of knowledge nodes tailored to a specific user's current knowledge state and goals.
_Avoid_: Study plan, roadmap, timeline

**Main Path**:
The primary sequence of knowledge nodes required to achieve the course objective.
_Avoid_: Core track, syllabus track

**Detour**:
A dynamically inserted prerequisite node into the learning path when a knowledge gap is diagnosed.
_Avoid_: Branch, sub-lesson, remedial step

**Side Note**:
An optional contextual explanation or tangential topic requested by the user that does not alter the main learning path.
_Avoid_: Extra tip, digression, footnote

**Learning Session**:
An active learning interaction spanning a user, a course, a current knowledge node, and an AI Tutor context.
_Avoid_: Chat session, room, thread

---

### Lesson & Interaction Domain

**Lesson**:
A structured, non-freeform collection of typed blocks representing the learning content for a specific knowledge node.
_Avoid_: Article, page, slide, chat log

**Lesson Block**:
A strictly typed, bounded UI component within a Lesson (Text, Code, Diagram, Quiz).
_Avoid_: Widget, section, element, card

**Lesson Patch**:
An atomic, versioned structural mutation (insert, replace, update, remove, move) applied to a Lesson's blocks.
_Avoid_: Page rewrite, edit, diff, streaming HTML

**Assessment**:
An evaluated diagnostic evidence record generated from user quiz submissions or explanations that feeds into the User Knowledge State.
_Avoid_: Exam, grading, test result
