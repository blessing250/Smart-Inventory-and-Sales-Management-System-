# Spring sales, payments and online orders

Milestone 6 adds POS, customer receivables, account postings, sale returns, and online order confirmation to the isolated Spring service. Next.js and SQLite remain the sole live application. Work on this milestone used disposable databases.

Milestone 7 extends the account posting service and records usable returns for archived products as held. [Current finance and archived return behavior](SPRING_FINANCE.md)

## Flyway V6

V6 creates ten tables and two read views under `bizflow_foundation`. V1 through V5 retain their original contents. The staging sale header is `retail_sales` so the existing database guard can continue rejecting databases with legacy business tables.

| Data | PostgreSQL structures and constraints |
| --- | --- |
| Customer identity | `customers` stores stable contact IDs. Names can repeat. Sales and orders capture customer names as transaction snapshots. |
| Sale and COGS | `retail_sales` and `sale_items` store operation reference, request fingerprint, customer, channel, date, gross, discounts, revenue, product/SKU snapshots and captured cost. Each item points to a unique stock movement. |
| Cash and receivables | `financial_accounts`, `financial_postings`, `sale_payments` and `financial_account_balances` store accounts and append-only application posting history. References and payment-to-posting links are unique. A reversal links to exactly one original posting, and an original can have at most one reversal. |
| Returns | `sale_returns` links a return to the original sale and item through a composite foreign key. It records condition, revenue credit, restored cost, and any linked stock movement and refund posting. References and posting links are unique. |
| Online orders | `online_orders` and `online_order_items` retain quoted prices, fulfillment, and a single linked sale after confirmation. |
| Audit and balances | `sales_audit` records events and actors. The `sale_balances` view derives outstanding, collected, reversed and refunded amounts, payment status, and gross profit. V6 adds `SALE` and `SALE_RETURN` to the existing inventory ledger. |

## Owner endpoints

| Area | Paths under `/api/v1` |
| --- | --- |
| Checkout and history | `GET/POST /sales`, `GET /sales/{id}`, `GET /sales/{id}/reconciliation` |
| Customers | `GET/POST /customers`, `GET /customers/{id}/sales`, `GET /customers/{id}/balance` |
| Accounts | `GET/POST /financial-accounts`, `GET /financial-accounts/{id}/reconciliation` |
| Collections | `GET/POST /sales/{id}/payments`, `POST /sales/{id}/payments/{paymentId}/reverse` |
| Returns | `GET/POST /sales/{id}/returns` |
| Online orders | `GET/POST /online-orders`, `GET /online-orders/{id}`, `POST /online-orders/{id}/confirm`, `POST /online-orders/{id}/cancel`, `PUT /online-orders/{id}/fulfillment` |

Routes use an active owner JWT and the existing session validation, expiry and revocation checks. Writes check origins and take the actor from the token. Sales list filtering supports reference or customer search, inclusive sale dates, and payment status, with stable paging. The current SQLite PDF receipt remains live. Spring exposes its source sale, payment and return data through the JSON detail endpoint. [OpenAPI](../backend/spring/openapi.yaml)

## Transaction and accounting rules

- One checkout transaction validates cumulative units for duplicate SKU lines, locks touched products in ID order, and stores server-calculated prices and discounts. Existing inventory movements supply the exact value removed, and each sale line captures it as cost of goods sold. The payments and audit commit with inventory. Sale mutations serialize with a transaction lock, and inventory and account row locks coordinate across modules. This simple locking strategy limits retail write throughput and should be measured in a staging workload.
- A walk-in can check out without a contact when payment covers the full total. An unpaid balance requires a stable customer ID. This is stricter than SQLite's name-only credit sales. A new online-order contact gets its own ID if the owner supplies a name without selecting a contact. Contact names never drive identity matching.
- Whole-franc payments go to an active RWF cash, bank, or mobile-money account that matches the method. Opening amounts, collections, refunds and reversals share the durable posting boundary. A RWF 150,000 sale with RWF 100,000 collected yields RWF 50,000 due and RWF 100,000 in account postings. Additional payments are limited to the remaining balance. A payment reversal preserves the original, checks account funds and post-refund cash entitlement, and requires a registered customer to carry the reopened receivable. Milestone 7 can extend this boundary for expenses, suppliers, shipments, transfers and native-currency movements.
- A return first credits any unpaid balance, then refunds only the excess through an eligible funded account. When the original payment used one eligible account it can be selected automatically. Usable returns restore inventory at the original line's cumulative rounded cost for the returned units. Damaged units consume their return entitlement while keeping their cost outside restored inventory. Sale gross profit follows revenue net of credits, less captured COGS net of restored costs. Payment and refund postings affect cash independently.
- An identical sale or return retry reuses the existing record. Reusing a reference with a different payload conflicts. An online order keeps its quote and has no stock effect until confirmation. Confirmation row-locks the order and calls the same checkout service as POS. It returns the linked sale on an identical retry and keeps fulfillment separate from order and payment status.
- Standalone stock reversals of sale or return movements are blocked. Usable returns require an active SKU because the stock ledger rejects movements on archived products. An owner workflow for such returns remains open.

## SQLite mapping and migration checks

| SQLite source | Target and reconciliation |
| --- | --- |
| `contacts` with Customer kind | Preserve IDs and contact data in `customers`. Retain existing `customer_id` links and name snapshots. Identify name-only historical receivables for owner review. |
| `sales`, `sale_items` | Preserve transaction and item IDs, channel, charged price, captured COGS, and total. Use the original checkout payload for gross and discounts when available. Where it is absent, preserve charged prices and document the missing discount history. Resolve product snapshot evidence explicitly. |
| `payments`, `money_transactions`, `money_reversals` | Preserve collection IDs, reference, actor, time, method, amount, accounts, and financial linkage. Load original and compensating entries once. Compare net paid and receivable per sale and account movement totals. |
| `sale_returns` | Preserve return ID, original sale-item reference, all recorded amounts, time and actor. Map restoration and disposition evidence. Represent each legacy refund as one refund posting where SQLite carried it directly on the return. |
| `online_orders`, `online_order_items` | Carry IDs, contact and channel/source, stored quote, order and delivery status, and the existing sale link. Resolve name-only identities with source evidence. |
| `accounts`, `stock_movements`, audit data | Preserve account IDs and type/currency, reconcile funds per account, and map original stock movement, actor and timestamp IDs. Verify before/after stock values and map historical IDs to UUIDs when needed. Preserve original retry keys and payload evidence. Use documented import fingerprints where no matching canonical request exists. |

Read a disposable SQLite snapshot through a read-only connection. Stage historical business rows and their existing stock and financial events directly. Do not call checkout, return, confirmation, or payment command handlers during import. Compare counts, references, loaded dates/actors, sold and returned quantities, stock value, COGS, revenue net of credits, receivables, and account balances at a shared cutoff. Full balances for accounts with non-retail transactions require the Milestone 7 posting types and import mapping. Record and explain every difference before planning cutover. A row-level rehearsal is still pending.

## Files and next milestone

Added Flyway V6, sales DTOs and controller, checkout and online-order services, exact return calculations, the financial posting service, unit tests and HTTP/PostgreSQL integration tests. Updated bearer route security, the existing stock ledger and movement filter, procurement product lock order, test fixture cleanup, OpenAPI, and milestone documentation. No files were removed for this milestone.

Sales uses existing landed inventory value and keeps historical COGS. Coordinated receipt corrections will need to respect downstream sales and restored stock value. Shipment discrepancy settlement belongs in Milestone 7 and does not gate staging POS. Before cutover, extend the durable posting service for the remaining finance flows, rehearse the row-level migration, reconcile stock and all account balances, and obtain explicit approval.

## Verification

- Maven verification passed all 17 tests against disposable PostgreSQL 18.4. This includes two new calculation tests and four new HTTP integration tests covering checkout rollback, concurrent sales, mixed payments and reversals, returns and refunds, online confirmation, JWT denial and revocation, reconciliation, and persistence across connections.
- A separate disposable V5-to-V6 upgrade preserved a seeded stock movement and its balance of two units valued at RWF 101. The migration created zero sales and zero financial postings.
- Next.js production build, frontend lint, all 41 Vitest tests, and the SQLite API smoke test passed. The OpenAPI contract parsed and all 22 new operations matched the controller.
- Docker Compose configuration validated. Docker runtime testing was blocked because the Docker engine was unavailable.
