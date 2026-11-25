# Implementation plan and phase status

Flyway V5 adds staging purchasing, shipment manifests, partial receiving and landed-cost reconciliation. The migration rehearsal and coordinated receipt correction workflow remain open. [Spring procurement](SPRING_PROCUREMENT.md)

Flyway V6 adds staging POS, customer receivables, payments, returns, refunds and online checkout. The existing SQLite application remains authoritative. [Spring sales](SPRING_SALES.md)

Flyway V7 adds staging RWF financial operations, optional expense receipts, shipment claim settlements and financial reconciliation. Native-currency accounts and coordinated corrections remain open. [Spring finance](SPRING_FINANCE.md)

Milestone 8 adds native currency operations, supported receipt reversals, reporting, exports and opt-in staging React integration. [Milestone 8 verification and cutover gaps](SPRING_MILESTONE_8.md)

The [Spring catalog milestone](SPRING_CATALOG.md) records the parallel PostgreSQL schema, owner-only staging API, and constraints on retiring the current business stack.

| Phase | Delivered | Outstanding |
| --- | --- | --- |
| 1. Audit | Reviewed Next.js pages, handlers, store, session configuration, tests and SQLite prototype. Recorded data risks. | Reconcile any separately retained business records before a legacy import. |
| 2. Foundation | Versioned SQLite, owner authorization, audit events, explicit upgrade opt-in, grouped navigation, business and receipt settings, category/channel suggestions, payment labels and exchange-rate defaults. | End-to-end standardization of the legacy forms, feedback and pagination. Custom payment instruments remain open. |
| 3. Inventory | SKU, photos, product families and variant attributes, audited counts, availability with awaited quantities, damage/missing incident counts and safe archiving. | Current unavailable-stock holding and disposition workflow. |
| 4. Purchases and imports | Manifest reservations, repeat receipts, charge locking, deterministic landed-cost allocations, and reconciliation of usable, damaged, missing and outstanding units. Legacy shipment receiving remains available. | Shipment plan amendments and separate financial settlement of damage and shortages. |
| 5. Sales and customers | POS, returns, online orders, stable contact IDs on sales, purchases and online orders, rename support and an unlinked-history review queue. | Review actual unlinked historical records with the owner. |
| 6. Finance | Additional cash, bank and mobile-money accounts, balance tracking, transfers, supplier and shipment payments, and reversals. | Other account types, selecting custom accounts during POS posting, and foreign-currency cash settlements. |
| 7. Reporting | Daily, weekly and period summaries, pending shipments and gross profit on the dashboard, and operational reports with matching filtered PDF/Excel exports. | Server-side pagination for high volumes and historical as-of account and stock balances. |

Keep loss and supplier-credit treatment separate from inventory reconciliation until the owner approves the posting policy. Foreign cash settlements also need explicit decisions on account currency, conversion date, bank fees, and any exchange gain or loss. The current ledger posts RWF amounts. Record original settlement currency, amount, captured conversion rate and posted RWF separately when extending it.

## Phase verification

| Phase | Areas reviewed and checks performed | Database impact |
| --- | --- | --- |
| Audit | Existing schema, route guards, dashboard forms and fixture paths. Checked the configured SQLite filename without opening or changing any private data. | None. |
| Foundation | Login, owner guard, existing role navigation, and database reopen. | Versioned schema with durable user and audit records. |
| Inventory | Product configuration, stock write paths, zero opening balance, SKU, adjustment and oversell rollback. | Product and stock ledger tables, counts, disposition and images. |
| Purchasing | Purchase and receipt forms, currency conversion and landed-cost rounding. Tested 100 units at RWF 2,900 landed per unit and rejection of excess receiving. | Purchase lines and currency snapshots, shipments, expense allocations and receipt references. |
| Sales | Checkout, online order and payment flows. Tested transaction rollback, one-time confirmation, balance enforcement and return refund calculation. | Sales, payments, online orders, retry keys and returns. |
| Finance | Account and transfer flows. Tested net balances, duplicate payment rejection, and posting reversal. | Accounts, money transactions and reversal events. |
| Reporting | Dashboard, report filters and export entry points. Validated that transfers leave sales and operating expenses unchanged. | Date indexes and read queries built on operational records. |

## Restructuring release checks

`pnpm lint`, `pnpm build`, and `pnpm test` passed. The suite retains all 14 baseline tests and adds seven regression tests. The initial migration fixture failed because it omitted the required reorder threshold. The corrected fixture verifies that version 12 requires explicit upgrade permission, and that the upgraded database preserves the legacy movement link and contact ID.

A production API smoke test used a disposable SQLite database. It covered owner login, denied anonymous access, legacy receiving, repeated manifest receipts and retry references, reconciliation, sale retry, dashboard totals, and both export formats. The filtered Excel rows matched the API report. Headless Chrome exercised the shipment page and mobile navigation at 390 px and the operational reports page at 1440 px.

## Phase 2 financial and operational delivery

| Workstream | Implemented | Remaining |
| --- | --- | --- |
| A. Discrepancies | Claim approval and rejection, applied purchase credits, verified RWF compensation, held damage, recovery and supplier returns, optional shortage closure, explicit losses and financial reversals. | Future-purchase credit balances, foreign-currency claim cash receipts, and a guided stock correction for recovery-dependent reversals. |
| B. Currency | RWF, CNY and USD native accounts, historical payable release, date and rate snapshots, realized settlement FX, and reversible two-leg exchanges with fees. | Historical as-of native balances and a documented period-end valuation policy. |
| C. POS | Eligible custom accounts, mixed collections, checked retry payloads, account-aware receipts, follow-up collections and refund routing. | Sales and customer refunds continue to settle in RWF. |
| D. Search and paging | SQL-paged operational and audit history, filters, stable sorting, count, page controls and cancellable searches. Sales and Finance use it inline. Operational report endpoints can return a page while exports include every matching row. | Existing purchase, shipment, stock, product and contact editing screens retain their original data loads. Some aggregate reports still materialize matching data before slicing the response. |
| E. Migration and security | Owner-protected endpoints, versioned forward upgrades with explicit opt-in, auditable decisions and atomic payments, settlement and stock operations. | Review the upgrade against a backup of the owner's database before enabling it. |

Prioritize a supplier-credit subledger for future purchases. It needs a separate accepted credit balance, native denomination, explicit application and reversal records, and reconciliation with existing payable credits so a claim cannot be collected twice.

### Phase 2 verification

`pnpm lint`, `pnpm build`, and `pnpm test` passed. The automated suite had 30 passing tests and zero failures, including the 21 baseline tests. It checked owner access, upgrade opt-in and preservation, claim compensation, loss and recovery, native credit, CNY and USD settlements, currency exchanges and reversals, mixed payments, refund routing and Kigali filtering before pagination.

A production smoke test used a disposable SQLite database. It checked owner login, rejection of anonymous and invalid requests, legacy and manifest receipts, financial resolution, mixed checkout retries, FX and native account balances, history paging, and PDF/Excel downloads. The filtered Excel rows matched the API report. Headless Chrome checked shipments, POS and claims at 390 px and reports and finance at 1440 px.

## Phase 3 delivery

| Area | Changes |
| --- | --- |
| Sales and contacts | Product-first checkout with live stock and prices, exact SKU selection, saved contact search and inline create, plus existing account-aware and mixed collections. |
| Catalog and purchasing | Essential product fields first, reusable suggestions, atomic preview-and-confirm XLSX/CSV import, browser-saved purchase drafts, exact fixed-point totals, explicit FX rate review and retry-safe purchase posting. |
| Receiving | Existing manifests and receipts with charge details and an automatically generated retry reference when the owner leaves the field blank. |
| Expenses and dashboard | A dedicated expense form, saved account and recent category suggestions, native amount preview, account balances, reversible paged expense history, category and date summaries, matching PDF/Excel exports, dashboard quick actions and unresolved exceptions. |

Receipt references and file attachments are optional. Attach a receipt while posting or from existing expense details. Drafts remain local to the current browser. Migrations 22 and 23 require the existing explicit upgrade opt-in.

`pnpm test` passed all 35 tests, including the 30 baseline tests. The new checks cover expense retry and reversal, native account deductions, exclusion of other outflows, category snapshots, filtered report totals, atomic import and purchase retry. The database reopen check verifies a posted expense and its account balance. `pnpm lint` and `pnpm build` also passed.

The production smoke test used disposable data and checked owner authorization, expense posting and reversal, matching expense PDF and Excel totals, purchase retry, product import and split receipts. Chrome checks covered expenses, POS and shipments at 390 px, and reports, CSV/XLSX previews and purchase draft save/resume at 1440 px.

## Phase 4 delivery

Use the [deployment guide](DEPLOYMENT_GUIDE.md) to provision a single service on a persistent volume. Use the [backup and restore runbook](BACKUP_AND_RESTORE.md) to verify snapshots, rehearse recovery and prepare explicitly approved upgrades. The [release gates](PRODUCTION_READINESS.md) track verified results and remaining deployment acceptance work.
