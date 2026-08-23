import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';

export type AiRole =
 | 'tutor'
 | 'knowledge_compiler'
 | 'artifact_synthesizer'
 | 'course_planner'
 | 'lesson_generator'
 | 'assessment';

export interface ModelPreferences {
 userId: string;
 defaultProviderId?: string;
 defaultModelId?: string;
 thinkingLevel: string;
 updatedAt: string;
}

export interface RoleModelPreference {
 userId: string;
 role: AiRole;
 providerId: string;
 modelId: string;
 thinkingLevel: string;
 updatedAt: string;
}

interface PreferencesRow {
 id: string;
 user_id: string;
 default_provider_id: string | null;
 default_model_id: string | null;
 thinking_level: string;
 updated_at: string;
}

interface RolePreferenceRow {
 user_id: string;
 role: string;
 provider_id: string;
 model_id: string;
 thinking_level: string;
 updated_at: string;
}

export class ModelPreferencesRepository {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 getPreferences(userId: string = 'default-user'): ModelPreferences | null {
  const row = this.db
   .prepare(
    'SELECT id, user_id, default_provider_id, default_model_id, thinking_level, updated_at FROM ai_preferences WHERE user_id = ?'
   )
   .get(userId) as PreferencesRow | undefined;

  if (!row) {
   return null;
  }

  return {
   userId: row.user_id,
   defaultProviderId: row.default_provider_id ?? undefined,
   defaultModelId: row.default_model_id ?? undefined,
   thinkingLevel: row.thinking_level,
   updatedAt: row.updated_at,
  };
 }

 setPreferences(
  userId: string = 'default-user',
  preferences: {
   defaultProviderId?: string;
   defaultModelId?: string;
   thinkingLevel?: string;
  }
 ): ModelPreferences {
  const now = new Date().toISOString();
  const id = randomUUID();

  this.db
   .prepare(
    `INSERT INTO ai_preferences (id, user_id, default_provider_id, default_model_id, thinking_level, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           default_provider_id = excluded.default_provider_id,
           default_model_id = excluded.default_model_id,
           thinking_level = excluded.thinking_level,
           updated_at = excluded.updated_at`
   )
   .run(
    id,
    userId,
    preferences.defaultProviderId ?? null,
    preferences.defaultModelId ?? null,
    preferences.thinkingLevel ?? 'medium',
    now
   );

  return {
   userId,
   defaultProviderId: preferences.defaultProviderId,
   defaultModelId: preferences.defaultModelId,
   thinkingLevel: preferences.thinkingLevel ?? 'medium',
   updatedAt: now,
  };
 }

 getRolePreference(userId: string = 'default-user', role: AiRole): RoleModelPreference | null {
  const row = this.db
   .prepare(
    'SELECT user_id, role, provider_id, model_id, thinking_level, updated_at FROM ai_role_preferences WHERE user_id = ? AND role = ?'
   )
   .get(userId, role) as RolePreferenceRow | undefined;

  if (!row) return null;

  return {
   userId: row.user_id,
   role: row.role as AiRole,
   providerId: row.provider_id,
   modelId: row.model_id,
   thinkingLevel: row.thinking_level,
   updatedAt: row.updated_at,
  };
 }

 setRolePreference(
  userId: string = 'default-user',
  role: AiRole,
  preference: {
   providerId: string;
   modelId: string;
   thinkingLevel?: string;
  }
 ): RoleModelPreference {
  const now = new Date().toISOString();

  this.db
   .prepare(
    `INSERT INTO ai_role_preferences (user_id, role, provider_id, model_id, thinking_level, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, role) DO UPDATE SET
           provider_id = excluded.provider_id,
           model_id = excluded.model_id,
           thinking_level = excluded.thinking_level,
           updated_at = excluded.updated_at`
   )
   .run(
    userId,
    role,
    preference.providerId,
    preference.modelId,
    preference.thinkingLevel ?? 'medium',
    now
   );

  return {
   userId,
   role,
   providerId: preference.providerId,
   modelId: preference.modelId,
   thinkingLevel: preference.thinkingLevel ?? 'medium',
   updatedAt: now,
  };
 }

 listRolePreferences(userId: string = 'default-user'): RoleModelPreference[] {
  const rows = this.db
   .prepare(
    'SELECT user_id, role, provider_id, model_id, thinking_level, updated_at FROM ai_role_preferences WHERE user_id = ? ORDER BY role ASC'
   )
   .all(userId) as RolePreferenceRow[];

  return rows.map((r) => ({
   userId: r.user_id,
   role: r.role as AiRole,
   providerId: r.provider_id,
   modelId: r.model_id,
   thinkingLevel: r.thinking_level,
   updatedAt: r.updated_at,
  }));
 }

 deleteRolePreference(userId: string = 'default-user', role: AiRole): void {
  this.db
   .prepare('DELETE FROM ai_role_preferences WHERE user_id = ? AND role = ?')
   .run(userId, role);
 }
}
