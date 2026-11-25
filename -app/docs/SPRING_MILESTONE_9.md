# Spring Milestone 9 release assessment

**PRODUCTION CUTOVER: NOT READY**

The work ran on `migration/spring-postgres-foundation` using disposable loopback databases. Next.js, NextAuth and SQLite continue to serve the live business. Production deployment, a live data export and a traffic switch require separate explicit authorization.

## Workflow parity

| Workflow | Existing Next.js | React/Spring staging | Tested | Difference |
| --- | --- | --- | --- | --- |
| Owner sign-in and renewal | NextAuth sign-in and owner verification | Spring owner login with rotating HttpOnly renewal and session revocation | Headless Chrome with the restored synthetic owner and Spring security tests | Live and staging owner sessions are separate. |
| Owner recovery | Mail recovery and reset page | Staging recovery form and fragment-based reset page using Spring | Backend recovery suite | Real mail delivery and browser recovery against the deployment host still need acceptance. |
| Dashboard and reports | Summary, reports, PDF and Excel | Spring reports and receipts, Recharts and filtered PDF/Excel | Regression suite and smoke | Full visual parity and all combinations of report filters need owner review. |
| Product catalog and variants | Product registration, families, variants and photos | Product registration, families, variant metadata, photo upload, edit and archive actions | Catalog HTTP and legacy smoke | Complete guided edit and archive journeys in the browser remain open. |
| Spreadsheet import | CSV/XLSX preview and optional ledger opening | Column mapping, duplicate/validation feedback, explicit skip/update and atomic confirmation | Parser and Catalog HTTP tests | Import leaves stock unchanged. Use the authorized inventory opening action as a separate operation. Image upload is separate. |
| Inventory and counts | Stock history, opening and counts | Ledger opening, draft and confirm count | Inventory HTTP suite | Full browser count journey remains open. |
| Customers and suppliers | Reusable contact directory | Spring-backed contact picker and creation | Mixed checkout browser and Spring API | Search in the picker is limited to its first 100 active entries. |
| Purchases and settlements | Purchase and supplier payment | Quick purchase and purchase allocation with native terms when applicable | Spring API | Complete browser purchase-to-settlement walkthrough remains open. |
| Shipments and costs | Manifest, charges and partial receiving | Manifest, charges, receiving and charge settlements | Spring API | Complete browser planning-to-receiving walkthrough remains open. |
| Shipment discrepancy and correction | Claim, decision, settlement and damage resolution | Read progress, claims, cash, credit, loss, history and guarded receipt reversal | Claim API and browser checks below | Physical recovery and shortage principal closure need a coordinated workflow. |
| POS and receipts | Single or mixed payments, partial payments and receipt | Multi-line cart, SKU search, live availability, RWF account filters, mixed tenders, credit and downloadable receipt | Browser and API checks below | Viewport checks cover selected paths. Owner acceptance still needs real daily-use feedback. |
| Additional payments, reversals, returns | Customer payments, reversal, returns and refund | Spring actions using original sale and payment references | Sales HTTP suite and staged API sequence | Full browser verification of the return and reversal forms remains open. |
| Online orders | Creation, confirmation and delivery | Creation, confirmation, fulfillment and cancellation | Sales HTTP suite | Full browser fulfillment and cancellation journeys remain open. |
| Accounts and expenses | Accounts, money out with optional receipts, transfers and exchanges | Account and transfer forms, quick expense with Kigali date, optional attachments and FX | API and browser checks below | Bank, native expense and attachment flows need full owner acceptance. |
| Settings | Business branding and operational settings | Business name, address, phone, receipt footer and audit history | Profile migration, staged API update and Excel branding | Custom channel labels, defaults and other operational preferences have no complete staging editor. |

## Implementation

V11 adds catalog import references, a business profile and its audit log, and a target for original legacy audit events. The import preview returns per-row errors, proposed actions and stock warnings. Confirmation revalidates the rows before writing, rejects changed payloads under a reused reference, and stores the outcome for exact retries. Case-insensitive duplicate rows are blocked. Existing product images and stock ledger entries remain intact. The browser accepts CSV or XLSX files up to 2 MiB with up to 200 rows. XLSX central-directory checks limit archive size and entry count. A product family is selected by its stable Spring ID.

The staged checkout filters accounts by payment method and RWF currency. It keeps a stable checkout reference through interrupted retries and derives each payment reference from the same attempt. The browser displays a preview and reports authoritative amounts from the successful Spring response. Spring posts the stock movement, COGS and payments together.

The shipment detail view uses Spring for manifest quantities, receipt history, financial exposure and claim status. It presents cash, credit or loss consequences before recording the action. The original receipt and its correction reason stay available. Unsafe corrections use the existing downstream stock and settlement guards.

The settings editor updates the profile through the owner API and records the prior values. Reports use the saved business name. Sales receipt PDFs can use the saved footer. The new staging reset path uses the existing Spring recovery and revocation logic. The operator must verify a recovery address separately before enabling SMTP recovery for a migrated owner.

## Historical rehearsal and restoration

The rehearsal constructs its source through the actual SQLite migrations, reopens it read-only, and maps existing rows directly into an isolated PostgreSQL transaction. It does not invoke sales, receiving or payment handlers. It reports source and destination values in JSON, including discrepancies. It rolls back by default. The `--retain-disposable-fixture` option commits only a fully reconciled synthetic fixture to a verified empty test database for the restoration test.

The expanded fixture includes an accepted supplier credit, shipped damage and shortage, native USD/CNY exchange and fee, the business profile, and the original legacy audit event. It retains the original owner identity and compatible bcrypt hash. Browser sessions and reset tokens are excluded. The known fixture supplies movement cost evidence. An unknown historical movement value or unsupported discrepancy disposition still requires review. A single synthetic scenario cannot establish how every legacy exception maps.

| Reconciliation measure | Source and destination |
| --- | --- |
| Stock | 3 units on hand, RWF 315 valuation, 4 historic movements |
| Receipt | 2 usable, 1 damaged and 1 missing, RWF 40 allocated and RWF 20 capitalized |
| Sales | RWF 300 net sales, RWF 105 net COGS, RWF 195 gross profit and RWF 100 refund |
| Outstanding balances | RWF 0 customer receivable and RWF 275 supplier payable after a RWF 25 credit |
| Account closing balances | RWF 920 cash, zero bank balance, USD 775 cents and CNY 1,400 fen |
| Exchange | USD 200 cents sent, CNY 1,400 fen received, 25 cents fee and RWF 38 reporting fee |

The local restore drill uses a native PostgreSQL custom-format dump and authenticates an AES-256-GCM backup before passing it to `pg_restore`. A deliberately altered byte failed authentication. An empty second PostgreSQL database restored in one transaction with the same stock, account and sales history. Cash and inventory matched again after restarting PostgreSQL. The drill uses an ephemeral local key and temporary artifact. Encrypted off-host storage and recovery using managed keys remain unverified.

## Verification and release gates

| Gate | Status | Evidence or remaining work |
| --- | --- | --- |
| Maven and disposable PostgreSQL regressions | PASS | All 26 Maven tests passed. Catalog tests exercise preview warnings, duplicate SKU validation, retries, conflict detection, update and zero stock. |
| Vitest, lint and production build | PASS | All 46 Vitest tests passed, including three new parser tests. Frontend lint and production build passed. |
| SQLite legacy API smoke | PASS | Owner guard, sign-in, products, sale retry, stock, purchases, dashboard, sales receipt and Excel passed. |
| Mixed checkout at 1440 px | PASS | Browser double-click produced one RWF 200,000 sale. RWF 50,000 posted to cash, RWF 100,000 to mobile and RWF 50,000 remained receivable. The receipt action was exercised. |
| Imports and expenses at 390 px | PASS | The browser imported CSV and XLSX through Spring and verified zero stock for the CSV import. A receipt-free expense saved and appeared as an expense with zero receipts. |
| Shipment discrepancy handling at 390 px | PASS | The mobile browser reviewed stock and financial exposure and posted RWF 10 partial cash compensation. A linked claim blocked receipt correction through Spring. |
| Follow-up payment, return, supplier payment, transfer and FX | PASS | Staged HTTP verified a RWF 15,000 follow-up payment, usable return and RWF 165,000 refund, supplier settlement, RWF transfer and native exchange. |
| Complete browser workflow parity | NOT TESTED | Registration, counts, purchase and receipt entry, payment reversals, refunds, settings and recovery need full browser walkthroughs. |
| Synthetic historical import | PASS | 40 reconciliation checks matched with zero discrepancies. The report emits comparison values and differences as JSON. |
| Approved representative historical snapshot | NOT TESTED | Synthetic relationships were rehearsed. Original historical valuation evidence and other exceptions require an approved disposable snapshot. |
| Owner migration and local Spring security | PASS | The restored owner authenticated using the migrated bcrypt hash. Chrome verified login, reload renewal and logout. Spring tests cover token expiry, invalid origin, recovery, revocation and rate limits. |
| Browser reset and SMTP delivery on staging host | NOT TESTED | Staging reset UI and routing are implemented. The approved mailbox and deployed browser journey were outside local verification. |
| Local encrypted restore and restart | PASS | Custom archive authenticated and restored. PostgreSQL restart preserved stock and cash. Spring restarted from the restored database and retained the staged mixed sale, refund and claim payment. |
| Encrypted off-host backup and restore | BLOCKED | An approved external store and separately managed recovery key were unavailable. The local drill cannot establish external recoverability. |
| Docker Compose configuration | PASS | The base and TLS staging overlay merged successfully. |
| Docker runtime, durable volumes and deployed HTTPS | BLOCKED | The Docker engine was unavailable. Container restart durability, certificate validity, Secure cookie transport and host monitoring still require staging acceptance. |
| Production authorization and cutover | NOT TESTED | No cutover was authorized. |

## Deployment and cutover plan

Docker Compose configuration validates. The Windows Docker client cannot connect to `dockerDesktopLinuxEngine`, so runtime acceptance is blocked. No changes were made to host services or production infrastructure. See the staging commands and restore prerequisites in the [deployment guide](DEPLOYMENT_GUIDE.md).

1. Complete the untested owner workflows and the remaining historical mappings. Run the guarded migration on a representative approved disposable snapshot and resolve every discrepancy.
2. Prove isolated Docker start and restart, valid TLS, approved SMTP delivery, durable storage, monitoring, off-host encrypted backups and a restoration drill from that external backup.
3. Obtain explicit cutover authorization, agree on a maintenance window and freeze legacy writes. Take verified snapshots, import final historical data without replaying activity, and reconcile both sides before accepting PostgreSQL writes.
4. Before the first production write, rollback can route traffic back to the frozen SQLite source under the approved runbook. Once PostgreSQL accepts writes, stop writes and preserve both datasets. Recovery requires an explicit reverse migration or reconciliation of the new transactions before rollback.

## Files and cleanup

Added Flyway V11, catalog import and business profile APIs, staged mixed POS, import, recovery, settings and shipment review components, and the encrypted restore drill. Updated the Spring reporting and correction APIs, staged proxy, browser smoke and migration rehearsal, tests, OpenAPI and documentation. Removed the unused early Spring auth adapter, which had been superseded by the shared staging client. No authoritative routes, migration files or rollback assets were removed.

Next.js routing and React remain in use for both modes. NextAuth guards the current SQLite application. The SQLite driver, current business handlers, JS report generators and legacy API routes remain needed until the owner approves the replacement and the retention period expires. After cutover, remove NextAuth and the SQLite runtime entry points, obsolete routes and duplicate live reporting code. Retain read-only import and audit tooling, required backups and the rollback archive.

Post-cutover cleanup candidates, once their routes and consumers are retired:

- Remove `next-auth`, the legacy credentials route under `app/api/auth`, the NextAuth provider, and its legacy login and recovery handlers.
- Retire live SQLite database initialization and legacy `app/api` business adapters after routing tests prove all clients use Spring. Keep the SQLite reader and versioned schema required by historical tools.
- Remove legacy jsPDF generators after report and receipt approval. Keep SheetJS while staging spreadsheet import uses it.
