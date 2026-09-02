-- Sessions table to support persistent multi-session conversations
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

-- Messages table for conversation history across sessions
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Memories table for structured knowledge extracted from conversation
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  memory_class TEXT NOT NULL DEFAULT 'SEMANTIC' CHECK (memory_class IN ('WORKING', 'EPISODIC', 'SEMANTIC')),
  subject TEXT NOT NULL DEFAULT 'user',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  importance REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'EXPIRED', 'DISCARDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  valid_from TEXT,
  valid_until TEXT,
  embedding TEXT,
  source_message_id TEXT,
  superseded_by TEXT,
  FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (superseded_by) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memories_subject_key ON memories(subject, key);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_class_status ON memories(memory_class, status, expires_at);

