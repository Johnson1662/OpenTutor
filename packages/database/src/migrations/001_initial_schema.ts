import type { Database } from '../db.ts';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const migration001: Migration = {
  version: 1,
  name: '001_initial_schema',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'concept',
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_knowledge_states (
        user_id TEXT NOT NULL,
        knowledge_node_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('unknown', 'learning', 'weak', 'mastered')),
        confidence REAL NOT NULL DEFAULT 0.0,
        last_studied_at TEXT,
        last_assessed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, knowledge_node_id),
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        title TEXT NOT NULL,
        description TEXT,
        goal TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS course_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id TEXT NOT NULL,
        knowledge_node_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'main',
        importance REAL NOT NULL DEFAULT 1.0,
        position INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS course_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id TEXT NOT NULL,
        from_course_node_id INTEGER,
        to_course_node_id INTEGER,
        relation TEXT NOT NULL DEFAULT 'sequence',
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS learning_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        course_id TEXT NOT NULL,
        active_lesson_id TEXT,
        path_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS learning_path_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        knowledge_node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('main', 'prerequisite', 'detour')),
        status TEXT NOT NULL CHECK (status IN ('upcoming', 'current', 'completed', 'skipped')),
        position INTEGER NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES learning_sessions (id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id)
      );

      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        knowledge_node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK (status IN ('generating', 'active', 'completed')),
        blocks TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id)
      );

      CREATE TABLE IF NOT EXISTS lesson_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        objective TEXT,
        status TEXT NOT NULL,
        blocks TEXT NOT NULL,
        patches TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (lesson_id) REFERENCES lessons (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        knowledge_node_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        block_id TEXT,
        result TEXT NOT NULL CHECK (result IN ('correct', 'partial', 'incorrect')),
        confidence REAL NOT NULL DEFAULT 0.0,
        feedback TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (lesson_id) REFERENCES lessons (id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes (id)
      );

      CREATE TABLE IF NOT EXISTS learning_events (
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES learning_sessions (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_session_seq ON learning_events (session_id, seq);
    `);
  },
};
