import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { migrations } from '../backend/database/business-schema.ts';
import { newPassword } from '../shared/validation/recovery-input.ts';
import { verifyDatabase } from './database.mjs';

try {
  const [filename, confirmation] = process.argv.slice(2);
  if (!filename || !isAbsolute(filename) || confirmation !== '--service-stopped-and-backup-verified') {
    throw new Error('Provide an absolute database path and confirm the stopped service and verified backup.');
  }
  if (process.stdin.isTTY) throw new Error('Pipe a password from a masked prompt.');
  const password = newPassword.safeParse(readFileSync(0, 'utf8').replace(/\r?\n$/, ''));
  if (!password.success) throw new Error('Use at least 12 characters and at most 72 UTF-8 bytes.');
  if (verifyDatabase(filename) !== migrations.length) throw new Error('Apply the approved schema upgrade before recovering the owner.');

  const hash = bcrypt.hashSync(password.data, 12);
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    try {
      const owners = db.prepare("SELECT id FROM users WHERE role='admin'").all();
      if (owners.length !== 1) throw new Error('Expected exactly one existing owner.');
      const { id } = owners[0];
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);
      db.prepare('DELETE FROM password_resets WHERE owner_id=?').run(id);
      db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(randomUUID(), id, 'owner.password_recovered_offline', id, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  console.log('Owner password changed and prior sessions invalidated.');
} catch (error) {
  console.error(error.code ? 'Database recovery failed. Verify permissions, integrity and service status.' : error.message);
  process.exitCode = 1;
}
