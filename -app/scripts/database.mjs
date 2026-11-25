import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, linkSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrations } from '../backend/database/business-schema.ts';

export function verifyDatabase(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    const tables = ['users', 'products', 'stock_movements', 'sales', 'purchases', 'audit_log'];
    if (!migrations.some(migration => migration.version === version) ||
        tables.some(table => !db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table))) {
      throw new Error('Unrecognized BizFlow database schema.');
    }
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('SQLite integrity or foreign-key validation failed.');
    }
    return version;
  } finally {
    db.close();
  }
}

export async function createDatabaseCopy(source, destination, operation = 'backup') {
  if (!isAbsolute(source) || !isAbsolute(destination)) throw new Error('Use absolute database paths.');
  if (['-wal', '-shm', '-journal'].some(suffix => existsSync(destination + suffix))) {
    throw new Error('Choose a fresh destination without SQLite sidecar files.');
  }
  if (operation === 'restore') verifyDatabase(source);
  const parent = realpathSync(dirname(destination));
  const staging = mkdtempSync(join(parent, '.bizflow-'));
  const temporary = join(staging, 'snapshot.sqlite');
  try {
    chmodSync(staging, 0o700);
    const input = new DatabaseSync(source, { readOnly: true });
    try {
      input.exec('PRAGMA busy_timeout = 5000');
      await backup(input, temporary);
    } finally {
      input.close();
    }
    const output = new DatabaseSync(temporary);
    try {
      output.exec('PRAGMA journal_mode = DELETE');
      if (operation === 'upgrade') {
        const version = verifyDatabase(temporary);
        output.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
        try {
          for (const migration of migrations.slice(version)) {
            output.exec(migration.sql);
            output.exec(`PRAGMA user_version = ${migration.version}`);
          }
          output.exec('COMMIT');
        } catch (error) {
          output.exec('ROLLBACK');
          throw error;
        }
      }
    } finally {
      output.close();
    }
    chmodSync(temporary, 0o600);
    const version = verifyDatabase(temporary);
    const bytes = statSync(temporary).size;
    // Publishing by hard link is atomic and fails if the destination already exists.
    linkSync(temporary, destination);
    return { version, bytes };
  } finally {
    rmSync(staging, { recursive: true });
  }
}

async function main() {
  const [operation, source, destination] = process.argv.slice(2);
  try {
    if (!['backup', 'restore', 'upgrade', 'verify'].includes(operation) || !source || !isAbsolute(source) ||
        (operation !== 'verify' && (!destination || !isAbsolute(destination)))) {
      throw new Error('Usage: node scripts/database.mjs backup|restore|upgrade|verify ABSOLUTE_SOURCE [ABSOLUTE_NEW_DESTINATION]');
    }
    if (destination) {
      const target = relative(realpathSync(process.cwd()), realpathSync(dirname(destination)));
      if (!target || (!target.startsWith('..' + sep) && target !== '..' && !isAbsolute(target))) {
        throw new Error('Choose a private destination outside the application directory.');
      }
    }
    const result = operation === 'verify'
      ? { version: verifyDatabase(source), bytes: statSync(source).size }
      : await createDatabaseCopy(source, destination, operation);
    console.log(JSON.stringify({ event: `database.${operation}`, result: 'ok', time: new Date().toISOString(), ...result }));
  } catch (error) {
    const message = error.code ? `Filesystem or SQLite operation failed (${error.code}).` : error.message;
    console.error(JSON.stringify({ event: `database.${operation ?? 'unknown'}`, result: 'failed', time: new Date().toISOString(), message }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
