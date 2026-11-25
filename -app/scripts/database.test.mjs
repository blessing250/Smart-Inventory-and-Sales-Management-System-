import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { migrations } from '../backend/database/business-schema';
import { openBusinessDatabase } from '../backend/database/business-db';
import { createDatabaseCopy, verifyDatabase } from './database.mjs';

test('a live WAL backup restores committed records and protects existing files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bizflow-backup-'));
  const source = join(dir, 'source.sqlite');
  const snapshot = join(dir, 'backup.sqlite');
  const restored = join(dir, 'restored.sqlite');
  const db = openBusinessDatabase(source);
  try {
    expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    db.exec("INSERT INTO users VALUES ('owner','Owner','fixture@example.test','fixture','admin','2026-01-01')");
    await expect(createDatabaseCopy(source, snapshot)).resolves.toMatchObject({ version: migrations.length });
    db.exec("UPDATE users SET name='New name'");
    await expect(createDatabaseCopy(snapshot, restored, 'restore')).resolves.toMatchObject({ version: migrations.length });
    await expect(createDatabaseCopy(source, restored, 'restore')).rejects.toMatchObject({ code: 'EEXIST' });
    const recovered = openBusinessDatabase(restored);
    try {
      expect(recovered.prepare('SELECT name FROM users').get().name).toBe('Owner');
      expect(db.prepare('SELECT name FROM users').get().name).toBe('New name');
    } finally {
      recovered.close();
    }
    const corrupt = join(dir, 'broken.sqlite');
    writeFileSync(corrupt, 'invalid database');
    await expect(createDatabaseCopy(corrupt, join(dir, 'invalid.sqlite'), 'restore')).rejects.toThrow();
    const staleTarget = join(dir, 'stale.sqlite');
    writeFileSync(staleTarget + '-wal', 'stale journal');
    await expect(createDatabaseCopy(snapshot, staleTarget, 'restore')).rejects.toThrow(/sidecar files/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
}, 20_000);

test('an explicit migration of a verified version 21 backup preserves existing rows and leaves the source intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bizflow-upgrade-'));
  const source = join(dir, 'old.sqlite');
  const snapshot = join(dir, 'version21.sqlite');
  const upgraded = join(dir, 'upgraded.sqlite');
  try {
    const db = new DatabaseSync(source);
    try {
      for (const migration of migrations.slice(0, 21)) db.exec(migration.sql);
      db.exec("PRAGMA user_version=21; INSERT INTO users VALUES ('owner','Owner','fixture@example.test','fixture','admin','2026-01-01')");
      db.exec(`INSERT INTO money_transactions (id,kind,from_account,amount,reference,category,actor_id,recorded_at)
        VALUES ('legacy-expense','expense','Cash',1750,'fixture-reference','Packaging','owner','2026-01-01')`);
    } finally {
      db.close();
    }
    expect(() => openBusinessDatabase(source)).toThrow(/reviewed schema upgrade/);
    await createDatabaseCopy(source, snapshot);
    await createDatabaseCopy(snapshot, upgraded, 'upgrade');
    expect(verifyDatabase(source)).toBe(21);
    expect(verifyDatabase(snapshot)).toBe(21);
    expect(verifyDatabase(upgraded)).toBe(migrations.length);
    const recovered = openBusinessDatabase(upgraded);
    try {
      expect(recovered.prepare('SELECT name FROM users').get().name).toBe('Owner');
      expect(recovered.prepare('SELECT id,amount,category FROM operating_expense_entries').get())
        .toMatchObject({ id: 'legacy-expense', amount: 1750, category: 'Packaging' });
      expect(recovered.prepare('SELECT * FROM expense_receipts').all()).toEqual([]);
    } finally {
      recovered.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
}, 20_000);
