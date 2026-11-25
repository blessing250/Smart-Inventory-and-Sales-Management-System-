# Milestone 10 deployment readiness

**PRODUCTION CUTOVER: NOT READY**

Verification ran on `migration/spring-postgres-foundation` with synthetic records and disposable local databases. The existing Next.js and SQLite application remains authoritative. No production deployment, approved historical snapshot import or live-data cutover took place.

## Release gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Docker Compose configuration | PASS | Docker CLI 29.9.2 and Compose 5.6.1 validated the base and staging overlay with synthetic settings. Caddy publishes 80 and 443. PostgreSQL has a named volume and no public host port. |
| Docker runtime, image builds and volume persistence | BLOCKED | The `desktop-linux` context could not open `npipe:////./pipe/dockerDesktopLinuxEngine`. WSL uses version 2 by default and the `docker-desktop` distribution was stopped. Engine resources, image builds, container health checks, restart persistence and shutdown recovery require a reachable engine. |
| Local legacy and staging HTTP smoke | PASS | Legacy owner guard, sign-in, inventory, retry, purchase, dashboard, PDF and Excel passed. The same-origin Next.js to Spring proxy served login, inventory, sale, trend and Excel. Comparable synthetic sales produced RWF 100 revenue and RWF 51 cost of goods sold. |
| Synthetic historical reconciliation | PASS | The rehearsal matched 40 checks with zero discrepancies. The fixture checks product, movement, supplier, shipment, customer, expense, native account and audit relationships, with exact balances compared in integer units. [Synthetic reconciliation JSON](spring-milestone-10-synthetic-reconciliation.json) |
| Approved representative historical reconciliation | BLOCKED | No authorized snapshot was available. Original identifiers, business references, historical rates and monetary balances must be reconciled on the approved copy before cutover. |
| Local encrypted restore | PASS | PostgreSQL 18.4 accepted a custom-format archive protected with AES-256-GCM. The drill rejected tampering and restored into a clean disposable database. After a PostgreSQL restart, stock and cash still matched. |
| Independent backup and restore | BLOCKED | Approved independent storage, access controls and a separately managed recovery key were unavailable. There is no external upload, download or restore evidence. |
| Deployed HTTPS, reverse proxy and authentication transport | BLOCKED | A reachable approved staging host, DNS and public certificate were unavailable. Local same-origin proxy and authentication checks ran over loopback. |
| Real recovery email | BLOCKED | No approved SMTP credentials or test mailbox were available. The staging overlay now forwards the Spring SMTP settings to the container. Local recovery tests use synthetic credentials and an in-memory mail outbox. |
| Production approval and cutover | NOT TESTED | This work was limited to staging readiness. |

## Workflow acceptance

| Workflow | Result | Evidence |
| --- | --- | --- |
| Product, family, variant and image registration | PASS | Desktop form submissions saved and Spring returned the registered attributes and image. |
| Opening stock and physical count | PASS | The desktop opening balance recorded four units valued at RWF 400. The confirmed count left three units valued at RWF 300. |
| Suppliers, purchase order, shipment manifest, charges and partial receiving | PASS | A usable receipt added one unit at RWF 90 including allocated charges. Stock reached four units valued at RWF 390, with one ordered unit pending. |
| Damage, shortage, claim and compensation | PASS | The staging API exercised damage and shortage. The mobile browser submitted and accepted a shortage claim, posted RWF 10 partial cash compensation and confirmed finance reconciliation. A linked claim blocked receipt correction. |
| POS, follow-up collection, refund and receipt | PASS | The desktop mixed sale posted RWF 50,000 cash, RWF 100,000 mobile money and RWF 50,000 receivable exactly once despite a double-click. Follow-up collection reduced the receivable by RWF 15,000 and the usable return refunded RWF 165,000. |
| Online order confirmation | PASS | Desktop confirmation created one sale and decreased stock. |
| CSV and XLSX imports, expense without receipt | PASS | At 390 px the browser imported both formats and saved an expense with zero receipts. |
| Supplier payments, transfers, currencies and balances | PASS | Desktop forms posted supplier settlement, an RWF transfer and USD-to-CNY exchange. API balances reconciled in original currencies. |
| Dashboard and exports | PASS | Chrome rendered the dashboard chart and renewed its session on reload. The staging trend and spreadsheet endpoints and receipt download action passed. |
| Owner sign-in, sign-out and synthetic password reset | PASS | Chrome authenticated the migrated owner. A synthetic one-time token seeded by hash let the browser submit a new password, clear the URL fragment, revoke a prior bearer and reject reuse. Spring accepted the new password after restart. Mail delivery remains blocked. |
| Full browser coverage of corrections, reversals, settings and all export variants | NOT TESTED | Selected cases are covered by Spring integration and HTTP smoke. The complete browser walkthrough remains outstanding. |

## Automated tests and implementation review

| Check | Result | Evidence |
| --- | --- | --- |
| Maven, including PostgreSQL integration | PASS | 26 tests, zero failures, errors or skips. Authentication coverage includes expiry, origin rejection, revocation, recovery and rate limits. Integration tests verify independent stock and financial postings. |
| Vitest | PASS | 46 tests passed in six files. |
| Frontend lint and production build | PASS | ESLint completed with exit code 0 and Next.js generated the production build used in the local smoke test. |

Spring uses Flyway V1–V11. The checked-in OpenAPI contract remains 0.9.0. The staging Compose overlay now forwards SMTP host, port, TLS mode, authentication and sender to Spring. The previous overlay only forwarded the recovery origin and path even though the deployment documentation described SMTP configuration. The application’s business API is unchanged by the Compose fix.

## Restore and financial reconciliation

The passing browser run used a 172,456-byte PostgreSQL archive. Backup creation took 0.639 seconds and restore with reconciliation took 2.456 seconds. Spring restart and verification took 9.672 seconds. The synthetic source had no concurrent writers. All 10 expected postings restored, and the staged sale, refund and claim compensation persisted after Spring restarted. These measurements cover local fixture operations. Production recovery time and data-loss exposure remain unmeasured.

The restored fixture held three units of RING-7 valued at RWF 315 across four movements. It held RWF 920 in cash and zero in bank and mobile money. The foreign balances were USD 7.75 and CNY 14.00, reconciled as 775 cents and 1,400 fen. The synthetic payable was RWF 275. Financial checks cover market-currency separation, transfer and expense classification, landed costs, returns and correction postings through the rehearsal and Spring integration tests. Rehearsal output includes comparison values and specific differences when a check fails.

## Staging evidence still required

1. Start Docker Desktop with the WSL2 engine on an approved Windows host. Confirm `wsl -l -v`, `docker version` and `docker info` show a running engine with sufficient CPU, RAM and disk. Use a dedicated hostname, private environment settings and an isolated Compose project, such as `docker compose -p bizflow-m10-staging -f compose.yaml -f compose.staging.yaml up -d --build` from `backend/spring`. Check service health, Flyway V1–V11, frontend forwarding and data persistence after application and database restarts and a graceful stop/start. Preserve named volumes. [Deployment guide](DEPLOYMENT_GUIDE.md)
2. Verify HTTP redirects, certificate chain and host name, forwarded scheme and trusted origin, secure cookie attributes, permitted same-origin writes, and rejection of foreign origins. Verify JWT expiry, refresh rotation, logout and recovery revocation through the deployed proxy. Verify traffic cannot reach PostgreSQL from the public network.
3. Supply approved test SMTP settings privately. Deliver to the approved mailbox, follow the HTTPS reset link in the browser and verify expiry, single use, old password rejection, session revocation and new-password login. Verify neutral responses for unrecognized accounts and check that token values are absent from logs. [Account recovery](ACCOUNT_RECOVERY.md)
4. Write and verify the encrypted backup in independent storage, verify access using the recovery role, then download and restore into an isolated clean instance. Restart Spring from the restored database, authenticate the owner and reconcile stock and accounts. Measure total elapsed recovery time and compare the recovered transaction boundary with a known committed transaction sequence. [Backup and restore](BACKUP_AND_RESTORE.md)
5. Obtain explicit approval for a representative SQLite snapshot. Record its checksum before rehearsal, run the guarded import against a disposable PostgreSQL target, preserve the JSON result with approved restricted access and resolve every difference before approval.

## Future cutover runbook

1. The business owner approves a maintenance window and the go/no-go criteria. The hosting operator approves the host, persistent volumes, HTTPS, monitoring and incident contacts. The database operator proves restore access, machine-readable reconciliation and a representative historical rehearsal. Record backup timestamps, checksums, the last transaction boundary and each approval.
2. Freeze legacy writes and pause automated writers. Verify the freeze, then take a consistent SQLite backup with the SQLite backup API or equivalent checkpoint-safe procedure. Account for WAL and related files. Retain the immutable final export and a verified encrypted recovery copy. Keep the legacy application and frozen database available for rollback.
3. Import into initialized PostgreSQL with the guarded migration path, preserving IDs, historical rates, costs and references without replay as current business activity. Compare entity counts, exact monetary totals in native units, stock and valuation, shipment and supplier balances, customer receivables, reversals and audit history. Hold writes and investigate any difference. Migrate the approved owner identity and compatible password hash, verify email and sign in again. Start new sessions on Spring.
4. Route the frontend and proxy during maintenance. Verify HTTPS, readiness, login, dashboards, stock and account totals, reports and exports using read-only live checks. Prove write workflows on the approved isolated environment before the window. Record the owner and operator go/no-go before enabling writes. Monitor readiness, error and authentication rates, database health, stock and account totals, backups and the first approved live posting.
5. **Before PostgreSQL accepts live writes**, revert routing and resume the original SQLite system after confirming the legacy data and service are consistent. **After PostgreSQL accepts live writes**, stop writers and capture both datasets and the exact transaction boundary. Prefer restoring service from PostgreSQL. If a return to SQLite is necessary, reconcile and validate a reverse migration of the accepted PostgreSQL transactions, including stock and monetary postings, before routing traffic or reopening writes.
6. After sign-off and the agreed rollback window, retire the legacy NextAuth provider, SQLite runtime adapters and duplicate report generation after verifying consumers are migrated. Retain guarded read-only SQLite import tooling, schema history, encrypted archives and audit records according to the approved retention plan. Next.js routing, React, TypeScript, Tailwind, Recharts and SheetJS still serve the current application. No legacy runtime deletion was required for this milestone.
