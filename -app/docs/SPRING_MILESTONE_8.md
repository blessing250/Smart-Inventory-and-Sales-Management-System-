# Spring Milestone 8 staging report

Next.js and SQLite continue to serve the live business. The Spring modules, staging React workspace and rehearsals use isolated data. Production routing and live data migration still require explicit approval.

## Finance and procurement

| Migration | Change and treatment |
| --- | --- |
| V8 | Extends the existing append-only financial posting with native source and destination amounts, currencies, the RWF reporting rate, exchange rate, and fee. The single account view sums native legs. Pre-V8 RWF entries retain their existing amounts. Foreign accounts return `balanceMinor` and a null `balanceRwf` because closing balances have no implicit valuation rate. |
| V9 | Adds original-receipt correction and movement links. Active receipt views exclude corrected quantities and costs. History still shows both the original and its corrected status. |
| V10 | Captures category snapshots for new sales and supports hashed browser refresh tokens. Earlier rows without a category snapshot use the catalog category during grouping. |

USD cents and CNY fen use two decimal places. RWF uses whole francs. Rates are scaled by one million and conversion rounds half-up using integer arithmetic. Same-currency transfers carry equal native amounts. An exchange requires explicit native legs and an agreed destination-per-source rate. The RWF equivalent uses the recorded source reporting rate, and an RWF destination must match that equivalent. Only the fee is a separate RWF cost. A reversal restores both native legs and the original fee while preserving the original posting.

Supplier payments keep the cash spent distinct from historical value released. Native obligations on purchase lines are discharged proportionally, with the final settlement releasing the exact remainder. Posting and allocation amounts must reconcile. Positive `fxLossRwf` represents an exchange loss and a negative value represents a gain. Exchange differences remain separate from product gross profit. Expenses and shipment payments can use native accounts with explicit reporting amounts and rates. Checkout, customer refunds and claim cash settlement remain RWF flows.

An owner can reverse the most recent applicable shipment receipt and post a replacement with a new receipt reference. Each eligible original stock movement has a linked reversal with the opposite quantity and value. The correction also reopens manifest quantities. Receipt dependencies, stock versions and replacement reservations are checked in the same transaction. Later stock activity, linked claims or payments, conflicting reservations, and multiple movements for one SKU in the same receipt require owner reconciliation. Charges become editable after all active receipts are corrected and payment history permits it. Existing historical manifest links prevent deleting or reassigning those original lines. Automatic corrections that would restate recognized COGS remain outside this workflow.

## Reporting and exports

[Reporting contract and usage](SPRING_REPORTING.md)

Spring uses filtered PostgreSQL data for all report totals. Sales and returns use their Kigali business dates. Account balances and inventory valuation are current snapshots. Reports keep customer receipts, payables, expenses, transfers, exchange differences and losses separate from sales and COGS. No data is fabricated for empty periods.

Apache PDFBox creates A4 reports with green headers, gold accents, dates, table rows, repeating headers and page numbers. Wide reports use landscape orientation. Apache POI generates Excel with date cells, currency labels, frozen headers and totals. Large integers are written as exact text when they exceed Excel numeric precision. Both formats use the JSON report's filters and full matching result set, up to the documented export limit. PDF uses a limited built-in font. Longer cells may truncate and unsupported characters display as question marks. Multilingual and dense export layout need broader acceptance testing. [Apache PDFBox](https://pdfbox.apache.org/3.0/getting-started.html) · [Apache POI](https://poi.apache.org/download.html)

## Browser staging and sessions

Set `BIZFLOW_STAGING_ENABLED=1` and `BIZFLOW_STAGING_SPRING_URL=http://127.0.0.1:8081` for a local Next.js staging run. Set Spring's `BIZFLOW_AUTH_APP_URL` to the exact browser origin and open `/staging`. The relay forwards only Spring API resource prefixes and approved request headers. Access tokens stay in memory. A hashed refresh secret rotates on use and lives in an HttpOnly, SameSite Strict cookie. HTTPS deployments use Secure cookies. Session renewal and logout require an exact trusted origin. The browser session expires after eight hours, and password reset or logout revokes it. The browser retries reads once after renewal and leaves interrupted writes for explicit retry.

Staging includes owner sign-in and profile, catalog and families, inventory count, purchase and manifest planning, receiving, sale and payment, returns, online checkout, RWF and foreign accounts, optional expense attachments and report downloads. It reuses the contact picker with a Spring directory adapter. Recharts displays backend net sales and gross profit over the selected dates. Production acceptance still needs guided product import, search across the full directory, image management, mixed tender entry, browser password recovery, shipment discrepancy and receipt correction screens, settings, and offline or flaky-network usability. The live workflows remain available in the existing application.

## Historical rehearsal

`node scripts/rehearse-spring-migration.mjs` creates a synthetic SQLite database from the repository's actual migrations. It then reopens that snapshot read-only and loads mapped rows into a Flyway-initialized disposable loopback PostgreSQL database in one rollback-only transaction. It accepts no input path. It reports checked identities, counts and values, with a nonzero result for discrepancies. It never invokes live posting operations.

The scenario covers owner identity, catalog, a product image, contacts, stock movements and count, purchase, shipment and discrepancy quantities, sale, order confirmation, payment, return and refund, expenses, supplier and shipment payments, transfer and reversal. Original audit/settings and extra manifest metadata are staged as evidence because their complete target configuration mapping remains open. The fixture validates the compatible bcryptjs format in the authentication test, including recovery and session revocation. No active sessions or reset secrets are imported. Live historical movement values require traceable evidence. They may be absent on legacy movement rows, so the synthetic rehearsal supplies independently known deltas and does not generalize that assumption to live data.

This is one cross-module synthetic rehearsal. A more representative anonymized or disposable snapshot still needs foreign account, historical charge, discount and movement evidence, exception review and full settings/audit mappings before cutover.

## Operations

From `backend/spring`, validate with `docker compose -f compose.yaml -f compose.staging.yaml config --quiet`. For an isolated TLS staging host, set the dedicated hostname, private PostgreSQL password and Spring signing key, then start with `docker compose -f compose.yaml -f compose.staging.yaml up --build`. Verify service health and logs with `docker compose -f compose.yaml -f compose.staging.yaml ps` and `logs`. Check restart persistence and rehearse `pg_dump` and `pg_restore` to a disposable database before deployment. The database has persistent storage and no published port. The overlay exposes only staging, its relay and frontend assets through Caddy. Keep staging public DNS and HTTPS independent of the live application.

Added three forward-only migrations, Spring report/export services, finance and correction endpoints, staging React and relay code, a Docker overlay, and synthetic rehearsal/smoke scripts. Updated the existing inventory and financial posting services, browser authentication, OpenAPI, tests and documentation. No live handlers or historical migrations were removed.

The next milestone should close workflow parity and historical evidence gaps, test staged backup and restore, run Docker acceptance, and rehearse rollback against a fully reconciled dataset before requesting cutover approval.

## Verification

- All 26 Maven tests passed on disposable PostgreSQL. Coverage included native USD/CNY balance and fee reversal, historical supplier cost and FX difference, concurrent idempotent receipt correction, rejection after a later sale, report filters, PDF/Excel totals and the owner recovery and revocation flow.
- All 43 Vitest tests passed, including the 41-test baseline and two staging client tests for shared renewal and interrupted writes. Frontend lint and production build passed.
- The SQLite production API smoke and same-origin Spring staging smoke passed. The matching sales fixture produced RWF 100 revenue, RWF 51 COGS and RWF 49 gross profit. Headless Chrome verified staging sign-in, the Recharts trend, renewal on reload and sign-out. Broader visual and transaction parity remain acceptance work.
- The cross-module SQLite rehearsal passed 33 checks with zero discrepancies. Its roll-back-only dataset reconciled three on-hand units at RWF 315, RWF 300 net sales, RWF 105 net COGS, a RWF 100 refund, zero customer receivable, RWF 300 supplier payable, and RWF 920 cash. Audit and settings evidence were compared inside the rehearsal.
- A separate V7-to-V10 upgrade preserved a seeded RWF 500 posting and two stock units valued at RWF 101, with no additional movement or posting.
- OpenAPI parsed with local references resolved. Staging Compose configuration validated. Docker runtime was blocked because the engine was unavailable.
