# Phase 4 release readiness

Spring production cutover remains **NOT READY**. See the [Milestone 10 release gates](SPRING_MILESTONE_10.md) for current acceptance results and the future cutover runbook.

The Spring finance module is staged on disposable PostgreSQL. The live SQLite application remains authoritative until historical data reconciliation, unresolved finance workflows and explicit cutover approval are complete. [Spring finance readiness](SPRING_FINANCE.md)

Milestone 8 adds an isolated TLS-oriented staging overlay and its owner browser sign-in. Validate Docker runtime, backup and restore, workflow parity, and historical reconciliation before any routing change. [Staging readiness and blockers](SPRING_MILESTONE_8.md)

**Production release status is NOT READY.** Local production-build checks passed. Production approval still requires a selected host, verified persistent and writable storage, HTTPS and proxy checks, and an off-server backup and recovery drill.

| Release gate | Status | Evidence |
| --- | --- | --- |
| Critical security checks | PASS locally / BLOCKED on host | Owner route tests and loopback production smoke covered invalid credentials, the credentials rate limit, anonymous access, cross-origin writes and logout. Host HTTPS cookies, proxy limits and network controls remain open. |
| Production dependencies | PASS | `pnpm audit --prod` reported zero known vulnerabilities. Next.js 16.4.6, NextAuth 4.24.15 and Zod 4.6.7 were verified. The lockfile uses SheetJS 0.20.3 from the [maintainer's distribution](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/). |
| Full development dependency audit | FAIL | `pnpm audit` still reported 28 high, 40 moderate, five low and zero critical findings. They are in the development graph, including legacy Prisma and build/lint/test tooling. Keep dev servers and tooling private. |
| Persistent database storage | PASS locally / BLOCKED on host | The production server reopened a restored database after restart and recovered 1,001 staged sales. Verify the chosen volume across host reboot and release replacement. |
| Backup creation and integrity | PASS locally / BLOCKED on host | Automated open-WAL backup and integrity tests passed. The CLI also backed up the running production build and verified the snapshot. The scheduler, alerts, ACLs and encrypted off-server copy require host setup. |
| Restore and business records | PASS locally / BLOCKED on host | Automated tests restored committed rows and rejected corrupt input or an existing destination. The server booted from the CLI-restored copy. Rehearse recovery from the actual off-server destination. |
| Migration compatibility | PASS on disposable data | Tests covered 12 → 23 and 21 → 23, including the explicit upgrade gate and preservation of the legacy expense and its reporting amount. The real database still requires operator approval, a verified backup and cutover reconciliation. |
| Financial reconciliation | PASS | Automated checks and API smoke reconciled partial sale payments, operating expenses without receipts, reversals, supplier settlements and credit, shipment settlement, transfers, funds and refunds. |
| Inventory and retry integrity | PASS for tested requests | Automated and API checks covered stock, landed costs, damaged and missing items, returns, and preserved inventory on retries. Stable references or keys are needed for retry protection. Some legacy API operations still accept requests without a key. |
| Full test and lint suite | PASS | `pnpm test` passed 40 of 40 tests across four files. `pnpm lint` passed. |
| Production build | PASS | `pnpm build` passed with Node.js 24.14.1 and pnpm 10.33.4, using a disposable database target. The build did not create a database file. |
| Core production APIs | PASS | Disposable loopback production smoke covered owner provisioning, readiness, duplicate submissions, reports and export downloads, and restart on restored data. |
| Browser workflow checks | PASS for tested checks | Headless Chrome loaded dashboard, POS, products, purchases, shipments, expenses, finance, reports and settings at 390 px and 1440 px without page-level horizontal overflow. It also opened mobile navigation and previewed a CSV import. Full business-form completion in the browser was NOT TESTED. |
| Report contents and layout | PASS for tested checks | API smoke checked A4 portrait receipt branding, payment and balance due, A4 landscape inventory report dimensions, repeated table headers and page numbers, and matching filtered expense totals in PDF and Excel. A final visual print review with actual company branding is NOT TESTED. |
| Synthetic dataset performance | PASS for measured fixture | Local fixture held 2,002 products and 1,001 sales plus associated payments and stock movements, a 12-line purchase, split shipment receipts and finance activity. Dashboard took 548 ms, sales 290 ms, inventory PDF 1,033 ms and Excel 236 ms in one local run. Production latency and long-term history size are NOT TESTED. |
| Hosting compatibility | BLOCKED | No host selected. Confirm a single Node 24 service, durable local SQLite storage and adequate space for backups before cutover. |
| Documented recovery and rollback | PASS | [Backup and restore](BACKUP_AND_RESTORE.md) and [Deployment guide](DEPLOYMENT_GUIDE.md). |
| Production approval | BLOCKED | Close the host, HTTPS and off-server recovery gates and get owner approval before cutover. |

The staging checks used synthetic records. The dashboard reads the sales history once per request. The history and expense pages provide SQL pagination. Several legacy list APIs still return full histories and should be measured against expected production growth.

## Owner account recovery

**Production recovery is pending.** The [account recovery runbook](ACCOUNT_RECOVERY.md) covers schema 24, the verified owner mailbox, TLS SMTP, and recovery through authenticated host access.

| Gate | Status | Evidence |
| --- | --- | --- |
| Single-use tokens and password updates | PASS locally | Disposable SQLite tests cover hashed tokens, 30-minute expiry, replacement, single use under concurrent submission, SMTP failure cleanup through an injected transport, old password rejection, audit history and unchanged stock. |
| Browser and session revocation | PASS locally | Chrome at 390 px and 1440 px completed the reset from the private outbox. The original authenticated session lost API access after the reset, sign-in with the old password returned 401, and the new password restored owner access. |
| Offline recovery | PASS locally | The CLI updated the existing owner on a disposable database after a verified backup and added its audit event. |
| Production reset-page safeguards | PASS locally | The production build served the reset page with `Referrer-Policy: no-referrer` and returned 503 when configured with the development-only file transport. |
| Production dependency audit | PASS | `pnpm audit --prod` reported no known vulnerabilities. pnpm reports a peer range warning for NextAuth v4's optional Nodemailer integration. BizFlow uses Credentials sign-in and a separate SMTP sender. |
| Production SMTP and owner mailbox | BLOCKED | Set a verified owner mailbox, configure a production sender and run the end-to-end test in approved HTTPS staging. |
| Live database cutover | BLOCKED | Use a verified backup and explicitly migrate a copy to schema 24 before enabling recovery. Earlier sessions require a new sign-in. |

## Spring authentication migration

Spring authentication uses an isolated PostgreSQL schema, an in-memory bearer adapter and a restricted owner command. The live application still uses NextAuth. Keep Spring behind the staging boundary until HTTPS and actual SMTP delivery, owner import, signing-key operations, proxy rate limits and browser integration are verified. See the [migration plan](../ARCHITECTURE_MIGRATION_PLAN.md) and [Spring setup guide](../backend/spring/README.md).

The [Spring catalog](SPRING_CATALOG.md) uses Flyway V3 and the existing owner JWT in staging. Inventory-ledger parity, live-data reconciliation and authorized cutover are required before retiring the legacy catalog. Docker execution requires a working engine.
