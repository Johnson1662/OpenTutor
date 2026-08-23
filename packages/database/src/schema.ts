import type Database from 'better-sqlite3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  from_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'prerequisite',
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_node_id, to_node_id)
);

CREATE TABLE IF NOT EXISTS user_knowledge_states (
  user_id TEXT NOT NULL DEFAULT 'default-user',
  knowledge_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('unknown', 'learning', 'weak', 'mastered')),
  confidence REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, knowledge_node_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_nodes (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  knowledge_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (course_id, knowledge_node_id)
);

CREATE TABLE IF NOT EXISTS course_edges (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  from_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, from_node_id, to_node_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  knowledge_node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('generating', 'active', 'completed')),
  blocks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL,
  blocks TEXT NOT NULL,
  patches TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(lesson_id, version)
);

CREATE TABLE IF NOT EXISTS learning_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default-user',
  course_id TEXT NOT NULL,
  active_lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  path_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_path_nodes (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  knowledge_node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('main', 'prerequisite', 'detour')),
  status TEXT NOT NULL CHECK(status IN ('upcoming', 'current', 'completed', 'skipped')),
  position INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);

CREATE INDEX IF NOT EXISTS idx_path_nodes_session_pos ON learning_path_nodes(session_id, position);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default-user',
  knowledge_node_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  block_id TEXT,
  result TEXT NOT NULL CHECK(result IN ('correct', 'partial', 'incorrect')),
  confidence REAL NOT NULL,
  feedback TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_learning_events_session_seq ON learning_events(session_id, seq);
`;

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}
