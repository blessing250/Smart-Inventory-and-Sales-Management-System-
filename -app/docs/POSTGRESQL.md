# PostgreSQL and pgAdmin 4

PostgreSQL stores the data. pgAdmin 4 connects to PostgreSQL and lets you browse tables, inspect views and run SQL queries.

BizFlow's frontend and backend run through one Next.js application. Set `BIZFLOW_DATABASE=postgres` to use PostgreSQL. Existing installations default to SQLite. Configure PostgreSQL password authentication and a dedicated role before importing business records. The inspected local server currently accepts loopback connections using `trust`.

## Open a staged copy in pgAdmin

Register a PostgreSQL server using host `127.0.0.1`, port `5432`, and your PostgreSQL credentials. Open the staging database, then expand **Schemas → bizflow_stage → Tables**. Right-click a table such as `products` and choose **View/Edit Data → First 100 Rows**. Treat the copy as private business data. [pgAdmin connection guide](https://www.pgadmin.org/docs/pgadmin4/latest/connecting.html)

## Prepare another staging copy

Take a verified, current-schema SQLite snapshot using the [backup runbook](BACKUP_AND_RESTORE.md). From the app directory, export it to a new SQL file in a private directory. Replace the example paths below with yours.

```powershell
node scripts/export-postgres.mjs 'D:\BizFlowBackups\verified.sqlite' 'D:\BizFlowBackups\postgres-stage.sql' bizflow_stage
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL export failed.' }
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
& $psql -X -h 127.0.0.1 -U postgres -d bizflow_staging -f 'D:\BizFlowBackups\postgres-stage.sql'
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL staging import failed.' }
```

Create the dedicated destination database first in pgAdmin. Use PostgreSQL 18 with ICU collation support. The import creates a new schema in one transaction and checks row counts. Use a new schema name for each repeat import. The export preserves business rows, account records and attachments, and excludes pending password reset tokens. The SQL file contains private records and owner password hashes and should be protected like a database backup.

## Connect the running app to a staged copy

1. Import a verified SQLite snapshot using the exporter for this release. The PostgreSQL backend checks the schema version installed by the import. Reimport old staging copies into a new schema.
2. Give a dedicated login role permission to connect to the database, use the imported schema, execute its functions, and read and write its business tables. Grant usage on its identity sequences and read access to the schema version table. Keep schema ownership with an administrative role.
3. Set these private environment values for the application and restart it.

   ```dotenv
   BIZFLOW_DATABASE=postgres
   DATABASE_URL=postgresql://bizflow_app:<encoded-password>@127.0.0.1:5432/bizflow_staging
   BIZFLOW_POSTGRES_SCHEMA=bizflow_stage
   ```

4. Start BizFlow once. Confirm readiness and verify sign-in, a sale, a purchase receipt, an expense reversal and a report on staged data. PostgreSQL runs separately as a service and pgAdmin is used to inspect it.
5. At cutover stop writes, import a final verified snapshot, repeat the reconciliation and retain the SQLite rollback copy. Maintain PostgreSQL backups with PostgreSQL tooling. The existing SQLite backup and offline owner recovery commands take SQLite files.

The PostgreSQL connection is pinned to one worker per app process for the synchronous transaction code. PostgreSQL advisory locks serialize app write transactions across connections to the same schema. Keep external writes out of pgAdmin during business operation. If a connection fails, restart the app and check the transaction history before retrying any write that may have committed.

## Run the database regression tests

Import a synthetic snapshot into a disposable schema named `bizflow_test_` followed by 12 hexadecimal characters. Set `BIZFLOW_TEST_POSTGRES_SCHEMA` and `BIZFLOW_TEST_POSTGRES_URL` for a test role that owns this disposable schema. Run `pnpm exec vitest run backend/database/data-store.test.ts`. The test suite clears its fixture tables between tests. With those test variables unset, the same suite runs on disposable SQLite.
