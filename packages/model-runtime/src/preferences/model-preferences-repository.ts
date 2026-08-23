import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';

export interface ModelPreferences {
 userId: string;
 defaultProviderId?: string;
 defaultModelId?: string;
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
}
