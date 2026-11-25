# Spring purchasing and shipment receiving

Milestone 5 adds owner-only procurement to the isolated Spring Boot service. Next.js and SQLite remain the sole live business stack. All milestone database validation used disposable databases.

## Schema and endpoints

Flyway V5 adds nine tables for contacts, orders and lines, shipments, manifest lines, charges, receipt headers and lines, and procurement audit events. Two views derive reservation and receiving progress. The schema uses stable IDs, unique references, foreign keys, quantity and amount checks, and a unique receipt-to-movement link. V5 adds the `PURCHASE_RECEIPT` movement kind to the existing ledger. V1 through V4 retain their original contents. [V5 migration](../backend/spring/src/main/resources/db/migration/V5__purchasing_and_receiving.sql)

| Area | Owner endpoints under `/api/v1` |
| --- | --- |
| Suppliers and agents | `GET/POST /procurement-contacts` |
| Purchases | `GET/POST /purchases`, `GET /purchases/{id}`, `POST /purchases/{id}/cancel` |
| Shipments | `GET/POST /shipments`, `GET /shipments/{id}`, `PUT /shipments/{id}/manifest`, `PUT /shipments/{id}/charges`, `POST /shipments/{id}/cancel` |
| Receipts and reconciliation | `GET/POST /shipments/{id}/receipts`, `GET /shipments/{id}/receipts/{receiptId}`, `GET /shipments/{id}/reconciliation` |

List endpoints paginate. Purchases support supplier and status filters and search by supplier name, order reference, or invoice reference. Shipments support status filtering and search by tracking reference or agent name. Owner JWTs supply the audit actor. Existing expiration and revocation checks apply. Writes also validate the request origin. [OpenAPI contract](../backend/spring/openapi.yaml)

## Reservations, receiving and costing

- A manifest can span multiple orders, and an order can span multiple shipments. Creating an order or manifest leaves physical stock unchanged. Available reservation quantity equals ordered minus usable, damaged, and active outstanding reservations. Shortages consume manifest quantity and release purchase eligibility. Units awaiting delivery remain outstanding.
- Record charge totals, including zero totals, before the first receipt. The first receipt locks the manifest and charge basis. Partial receipts move the shipment to `IN_TRANSIT`. A fully resolved manifest becomes `RECEIVED`. Cancellation releases unused reservations and retains receipts. An order can be cancelled only after active reservations are released and before any receipt history exists.
- Receipts distinguish usable, damaged, and confirmed missing units. Damage and shortages require explanations. Retrying the same reference, shipment, date, and normalized lines returns the same receipt. A changed payload conflicts. A transaction-scoped PostgreSQL advisory lock serializes procurement writes. Ledger operations also use the existing per-product lock and versioned balances. Receipts, ledger entries, balances, progress and audit commit atomically.
- RWF uses whole francs. USD and CNY use minor units. Orders capture RWF per source major unit at six decimal places and store half-up converted line subtotals. Quantity or converted supplier value determines each manifest line's share of shipping/transport, customs, clearing/handling, and other charges. A positive charge with zero total planned supplier value requires quantity allocation.
- Each receipt takes the difference between consecutive cumulative rounded amounts. Supplier cost follows usable and damaged units across all shipments on a purchase line. Charges follow all resolved units within each manifest, with usable units assigned first on each receipt line. The ledger capitalizes only usable supplier cost and usable charges. Damaged supplier cost and the charge share for damaged or missing units remain recorded pending financial resolution. Unprocessed units retain their unallocated charges.
- Reconciliation reports quantity progress, total, allocated, capitalized, held, and unallocated charges, supplier costs, and inventory value. It checks each linked movement's product, quantity and value, and verifies that completed manifests allocated all charges. The inventory reconciliation endpoint checks the entire ledger against balances. The milestone creates no settlements, write-offs, or credits. A generic stock reversal cannot reverse a purchase receipt independently of procurement.

## SQLite migration preparation

| Source | PostgreSQL mapping and validation |
| --- | --- |
| Supplier and agent rows in `contacts` | Preserve stable IDs and metadata. Retain supplier and agent name snapshots on transactions. Establish deterministic mappings for name-only records and resolve ambiguous identities before import. |
| `purchases`, `purchase_items` | Preserve IDs, references, product links, quantities, original unit minor prices, currency, rate and converted RWF. Review historical rows with fallback price fields. Reconcile order and line totals against source records. |
| `shipments`, `shipment_manifests`, `shipment_manifest_lines` | Preserve IDs, tracking, dates, agent IDs and purchase-line references. Translate legacy shipment forms explicitly and compare the reconstructed active reservations. |
| `shipment_expenses` | Preserve categories and amounts. Retain original expense links as migration evidence and reconcile each charge total to its capitalized, held and unallocated shares. |
| `shipment_receiving_events`, `shipment_receiving_lines` | Preserve receipt IDs, references, dates, explanations, quantities and cost components. Reconstruct the retry fingerprint when the original request is known. Review older `shipment_receipt_items` without receiving events before synthesizing event history. |
| `stock_movements`, actor IDs and timestamps | Reuse inventory ID mappings, preserve receipt-to-movement links, map actors to verified accounts, retain timestamp and time-zone evidence, and check for orphaned references. |

Read a disposable SQLite copy or synthetic fixture through a read-only connection. Export explicit IDs, exact integers and original timestamps, then load only into disposable PostgreSQL. Compare references, identities, reservation and receipt progress, charge splits, linked ledger values, and per-product quantities and valuation. Report mismatches alongside the source evidence. The target schema and reconnect tests verify storage of synthetic identities and values. A row-level legacy import rehearsal remains outstanding.

## Verification and handoff

- Maven passed 11 tests with disposable PostgreSQL 18.4 and Flyway V1 through V5. New integration scenarios cover reservations, partial receipts, exact allocation, idempotency, rollback, concurrency, ledger valuation, and owner session checks.
- Frontend lint, production build, all 41 Vitest tests, and the SQLite API smoke test passed. Docker Compose configuration validated. Container execution was blocked by the unavailable Docker engine.
- Added V5, the procurement controller, service, integer costing helper and PostgreSQL tests. Updated the inventory ledger and filter, catalog archive guard, security rules, inventory test fixture and documentation. No files were removed for this milestone.
- The next milestone should add coordinated receipt corrections and financial discrepancy resolution, followed by a disposable migration rehearsal. Production cutover requires full replacement verification and explicit authorization.
