import Database from 'better-sqlite3';
import { runMigrations } from './migration-runner.ts';

export type Database = Database.Database;

export interface DatabaseOptions {
  path?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
}

export function createDatabase(dbPathOrOptions?: string | DatabaseOptions): Database.Database {
  const options: DatabaseOptions =
    typeof dbPathOrOptions === 'string'
      ? { path: dbPathOrOptions }
      : dbPathOrOptions ?? {};

  const dbPath = options.path ?? process.env.OPENTUTOR_DB_PATH ?? ':memory:';

  const sqliteOptions: Database.Options = {};
  if (options.readonly !== undefined) sqliteOptions.readonly = options.readonly;
  if (options.fileMustExist !== undefined) sqliteOptions.fileMustExist = options.fileMustExist;
  if (options.timeout !== undefined) sqliteOptions.timeout = options.timeout;
  if (options.verbose !== undefined) sqliteOptions.verbose = options.verbose;

  const db = new Database(dbPath, sqliteOptions);

  // WAL mode for disk databases (in-memory ignores WAL)
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  if (!options.readonly) {
    runMigrations(db);
  }

  return db;
}
