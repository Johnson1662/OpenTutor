import type Database from 'better-sqlite3';

export interface AgentSessionRecord {
 id: string;
 learningSessionId: string;
 runtime: string;
 runtimeSessionId?: string;
 providerId?: string;
 modelId?: string;
 thinkingLevel?: string;
 status: string;
 createdAt: string;
 updatedAt: string;
}

interface AgentSessionRow {
 id: string;
 learning_session_id: string;
 runtime: string;
 runtime_session_id: string | null;
 provider_id?: string | null;
 model_id?: string | null;
 thinking_level?: string | null;
 status: string;
 created_at: string;
 updated_at: string;
}

export interface GetOrCreateAgentSessionParams {
 id: string;
 learningSessionId: string;
 runtime?: string;
 runtimeSessionId?: string;
 providerId?: string;
 modelId?: string;
 thinkingLevel?: string;
}

export class AgentSessionRepository {
 private readonly db: Database.Database;

 constructor(db: Database.Database) {
  this.db = db;
 }

 get(id: string): AgentSessionRecord | null {
  const row = this.db
   .prepare(
    'SELECT id, learning_session_id, runtime, runtime_session_id, provider_id, model_id, thinking_level, status, created_at, updated_at FROM agent_sessions WHERE id = ?'
   )
   .get(id) as AgentSessionRow | undefined;
  return row ? this.map(row) : null;
 }

 getByLearningSessionId(learningSessionId: string): AgentSessionRecord | null {
  const row = this.db
   .prepare(
    'SELECT id, learning_session_id, runtime, runtime_session_id, provider_id, model_id, thinking_level, status, created_at, updated_at FROM agent_sessions WHERE learning_session_id = ? ORDER BY created_at ASC LIMIT 1'
   )
   .get(learningSessionId) as AgentSessionRow | undefined;
  return row ? this.map(row) : null;
 }

 getOrCreate(params: GetOrCreateAgentSessionParams): AgentSessionRecord {
  const existing = this.get(params.id);
  if (existing) return existing;

  const now = new Date().toISOString();
  this.db
   .prepare(
    `INSERT INTO agent_sessions (id, learning_session_id, runtime, runtime_session_id, provider_id, model_id, thinking_level, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
   )
   .run(
    params.id,
    params.learningSessionId,
    params.runtime ?? 'pi',
    params.runtimeSessionId ?? null,
    params.providerId ?? null,
    params.modelId ?? null,
    params.thinkingLevel ?? 'medium',
    now,
    now
   );
  return this.get(params.id)!;
 }

 bindModel(id: string, providerId: string, modelId: string, thinkingLevel?: string): void {
  const now = new Date().toISOString();
  this.db
   .prepare(
    `UPDATE agent_sessions
         SET provider_id = ?, model_id = ?, thinking_level = ?, updated_at = ?
         WHERE id = ?`
   )
   .run(providerId, modelId, thinkingLevel ?? 'medium', now, id);
 }

 updateRuntimeSession(id: string, runtimeSessionId: string): AgentSessionRecord | null {
  this.db
   .prepare('UPDATE agent_sessions SET runtime_session_id = ?, updated_at = ? WHERE id = ?')
   .run(runtimeSessionId, new Date().toISOString(), id);
  return this.get(id);
 }

 private map(row: AgentSessionRow): AgentSessionRecord {
  return {
   id: row.id,
   learningSessionId: row.learning_session_id,
   runtime: row.runtime,
   runtimeSessionId: row.runtime_session_id ?? undefined,
   providerId: row.provider_id ?? undefined,
   modelId: row.model_id ?? undefined,
   thinkingLevel: row.thinking_level ?? undefined,
   status: row.status,
   createdAt: row.created_at,
   updatedAt: row.updated_at,
  };
 }
}
