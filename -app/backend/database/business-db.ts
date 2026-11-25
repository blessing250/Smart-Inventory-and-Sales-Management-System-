import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './business-schema';
import { PostgresDatabase } from './postgres-db';

export type BusinessDatabase = DatabaseSync | PostgresDatabase;

export class SchemaUpgradeRequired extends Error {
  constructor() {
    super('The business database needs a reviewed schema upgrade.');
  }
}

export function businessDatabasePath() {
  const configured = process.env.BIZFLOW_DB_PATH;
  if (process.env.NODE_ENV !== 'production') return configured || 'data/bizflow.sqlite';
  if (!configured || !isAbsolute(configured)) {
    throw new Error('Production requires an absolute BIZFLOW_DB_PATH on persistent storage.');
  }
  const filename = resolve(configured);
  const actual = existsSync(filename)
    ? realpathSync(filename)
    : join(realpathSync(dirname(filename)), basename(filename));
  const target = relative(realpathSync(process.cwd()), actual);
  if (!target || (!isAbsolute(target) && target !== '..' && !target.startsWith('..' + sep))) {
    throw new Error('Production SQLite storage must be outside the application directory.');
  }
  return actual;
}

export function databaseIsReady() {
  if (postgresSelected()) {
    const db = getPostgresDatabase();
    return Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get());
  }
  const db = new DatabaseSync(businessDatabasePath(), { readOnly: true });
  try {
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return version === migrations.length && Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get());
  } finally {
    db.close();
  }
}

export function transaction<T>(db: BusinessDatabase, run: () => T, mode: 'IMMEDIATE' | 'DEFERRED' = 'IMMEDIATE'): T {
  db.exec(`BEGIN ${mode}`);
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original transaction error. */ }
    throw error;
  }
}

function postgresSelected() {
  const driver = process.env.BIZFLOW_DATABASE;
  if (!driver || driver === 'sqlite') return false;
  if (driver === 'postgres') return true;
  throw new Error('Invalid BIZFLOW_DATABASE.');
}

const server = globalThis as typeof globalThis & { bizflowPostgres?: PostgresDatabase };
function getPostgresDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(?:ql)?:\/\//i.test(url)) throw new Error('PostgreSQL requires DATABASE_URL.');
  return server.bizflowPostgres ??= new PostgresDatabase(url, process.env.BIZFLOW_POSTGRES_SCHEMA || 'bizflow');
}

export function connectBusinessDatabase() {
  return postgresSelected() ? getPostgresDatabase() : openBusinessDatabase(
    businessDatabasePath(),
    process.env.NODE_ENV !== 'production' && process.env.BIZFLOW_ALLOW_SCHEMA_UPGRADE === '1',
  );
}

export function openBusinessDatabase(path: string, allowUpgrade = false) {
  const filename = path === ':memory:' ? path : resolve(path);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON');
    transaction(db, () => {
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (version > migrations.length) throw new Error('The business database requires a newer application.');
      if (version > 0 && version < migrations.length && !allowUpgrade) throw new SchemaUpgradeRequired();
      if (version === 0 && db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").get()) {
        throw new Error('Choose a new BizFlow database path. Existing data requires a reviewed import.');
      }
      for (const migration of migrations.slice(version)) {
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
    });
    if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
