import type Database from 'better-sqlite3';

export interface AgentRunRecord {
  id: string;
  sessionId: string;
  requestId: string;
  model: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AgentToolCallRecord {
  id: string;
  runId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: 'success' | 'error';
  startedAt: string;
  completedAt?: string;
}

export class TraceRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  startRun(params: { id: string; sessionId: string; requestId: string; model: string }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO agent_runs (id, session_id, request_id, model, status, started_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(params.id, params.sessionId, params.requestId, params.model, 'running', now);
  }

  completeRun(runId: string, status: 'completed' | 'failed' | 'cancelled', error?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE agent_runs SET status = ?, error = ?, completed_at = ? WHERE id = ?')
      .run(status, error ?? null, now, runId);
  }

  recordToolCall(params: {
    id: string;
    runId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result: unknown;
    status: 'success' | 'error';
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO agent_tool_calls (id, run_id, tool_name, arguments, result, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        params.id,
        params.runId,
        params.toolName,
        JSON.stringify(params.arguments),
        JSON.stringify(params.result),
        params.status,
        now,
        now
      );
  }

  getRuns(sessionId: string): AgentRunRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, session_id, request_id, model, status, error, started_at, completed_at FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC'
      )
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      request_id: string;
      model: string;
      status: AgentRunRecord['status'];
      error: string | null;
      started_at: string;
      completed_at: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      requestId: r.request_id,
      model: r.model,
      status: r.status,
      error: r.error ?? undefined,
      startedAt: r.started_at,
      completedAt: r.completed_at ?? undefined,
    }));
  }

  getToolCalls(runId: string): AgentToolCallRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, run_id, tool_name, arguments, result, status, started_at, completed_at FROM agent_tool_calls WHERE run_id = ? ORDER BY started_at ASC'
      )
      .all(runId) as Array<{
      id: string;
      run_id: string;
      tool_name: string;
      arguments: string | null;
      result: string | null;
      status: AgentToolCallRecord['status'];
      started_at: string;
      completed_at: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      toolName: r.tool_name,
      arguments: r.arguments ? (JSON.parse(r.arguments) as Record<string, unknown>) : {},
      result: r.result ? JSON.parse(r.result) : null,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at ?? undefined,
    }));
  }
}
