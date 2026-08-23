# 0003. SQLite as Primary Database for Local and Modular Persistence

We adopt SQLite as the primary storage engine for OpenTutor instead of requiring a separate PostgreSQL instance. SQLite provides zero-dependency embedded persistence, robust ACID transactions, single-file backups, and instant cross-platform portability (Node.js, local desktop, and future HarmonyOS environments) while fulfilling all relational modeling needs for Courses, Lessons, Paths, Knowledge States, and Assessments.
