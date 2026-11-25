# Backup and restore

## Spring PostgreSQL restore drill

`scripts/drill-spring-restore.mjs` accepts two distinct disposable loopback PostgreSQL test databases. Populate the source with the reconciled synthetic rehearsal and create the target as an empty database. Set the source through the Spring database variables and the target through `BIZFLOW_RESTORE_DATABASE`. Set `BIZFLOW_PG_BIN` when PostgreSQL tools are outside PATH.

```powershell
node scripts/rehearse-spring-migration.mjs --retain-disposable-fixture
node scripts/drill-spring-restore.mjs
```

The drill verifies authenticated encryption, rejects a tampered archive, restores in one transaction and compares inventory, finance and sale relationships. It excludes session and reset-token rows and uses a temporary local key. For release, retain a separately recoverable encryption key, put the encrypted archive in approved storage outside the application host, and execute the restore using the retrieved archive and recovered key. Verify Spring startup, owner authentication, stock, finance and history on the restored instance before signing off. [Release gates](SPRING_MILESTONE_9.md)

Run these commands from the app directory as an authorized operator using Node.js 24. Use precreated private directories outside the app, on volumes that support hard links. Use a fresh destination filename each time. Access to these files gives access to business data, attachments and password hashes. Restrict directory permissions and encrypt off-server copies.

## Back up a running application

```powershell
$live = 'D:\BizFlowData\bizflow.sqlite'
$snapshot = Join-Path 'D:\BizFlowBackups' ("bizflow-{0}.sqlite" -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
node scripts/database.mjs backup $live $snapshot
if ($LASTEXITCODE -ne 0) { throw 'BizFlow backup failed.' }
node scripts/database.mjs verify $snapshot
if ($LASTEXITCODE -ne 0) { throw 'BizFlow backup verification failed.' }
```

The command uses SQLite's online backup API, checks the schema version, integrity and foreign keys, and then publishes the checked file. The source may be open and in WAL mode. The result reports UTC time, schema version and size. Failure returns a nonzero exit code. Check each exit code before continuing to the next step.

Schedule daily backups with Task Scheduler or the host service manager. Copy verified snapshots to a private encrypted off-server destination through the host backup job and alert on either step failing. Start with a proposed retention of 14 daily and 8 weekly snapshots, subject to owner approval. Review storage and recovery needs before enabling deletion, and rehearse restoring off-server copies periodically. Keep a separately protected pre-upgrade snapshot.

## Restore or prepare an upgrade

1. Confirm the recovery point with the owner. Stop the service and any other writers before a real cutover. Preserve the current database and its SQLite sidecars in place. If readable, take and verify a new online backup of it first.
2. Recover the selected snapshot to a private location and run `node scripts/database.mjs verify ABSOLUTE_BACKUP_PATH`. Compare its schema version with the application release. The CLI accepts recognized BizFlow schemas. The running application requires its current version.
3. Run `node scripts/database.mjs restore ABSOLUTE_BACKUP_PATH ABSOLUTE_NEW_DATABASE_PATH`. Existing files are protected by exclusive destination publication. Validate the restore first in a disposable instance and check record counts, accounts, supplier and customer balances, stock valuation, expenses and receipts.
4. For an older schema, obtain explicit owner approval and run `node scripts/database.mjs upgrade ABSOLUTE_VERIFIED_BACKUP_PATH ABSOLUTE_NEW_DATABASE_PATH`. First verify the source and available space and permissions for a full copy and migration. Use a final verified snapshot taken after writes stop for the real cutover. The CLI applies pending migrations in a transaction on the copy and checks integrity again before publishing it. Production startup refuses older existing schemas even if the development opt-in is present.
5. Compare business records and balances before and after. Migration 22 adds operating-expense categories, report and retry data. Migration 23 adds optional file attachments. Migration 24 adds password reset token digests. Review the [database design](DATABASE_DESIGN.md) for expected changes.
6. Point the service at the verified new file, restart, check readiness and take a fresh backup. Record the timestamp, operator, source version, destination version, reconciliation and outcome in the operations log. To roll back, stop writes and point the compatible prior release at its preserved database. Reconcile any transactions made after cutover before reopening service.
