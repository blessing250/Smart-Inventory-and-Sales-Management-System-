# Spring finance and reconciliation

Milestone 7 extends the V6 posting service in the isolated PostgreSQL backend. Next.js and SQLite remain the live stack, including their finance screens, PDF and Excel exports. Real business data stays outside this milestone.

## Schema and posting rules

Flyway V7 adds posting types and business dates to `financial_postings` and makes the table append-only. V1 through V6 retain their original contents. The V6 financial account balance view continues to derive balances from the source and destination accounts on those same postings. V7 adds expense categories, operating expense and receipt details, supplier and shipment allocations, discrepancy claims and resolutions, and finance audit events. Payable and charge views exclude compensated postings. Foreign keys preserve business references, unique keys reject duplicate references, and checks enforce positive amounts and the required posting directions.

| Operation | Account and accounting effect |
| --- | --- |
| Account creation, rename and archive | Create an RWF cash, bank or mobile-money account, optionally with an opening posting. Only a zero-balance account can be archived. Its posting history stays available. |
| Operating expense | Debit the selected funded account. Category and amount are required, and the date defaults to the Kigali business date. Description, payee, supporting reference, related reference and attachment are optional. |
| Supplier payment | Debit the actual RWF paid. Allocate it across one or more purchases for the selected supplier. For USD or CNY purchases, explicitly record the native obligation discharged and release its cumulative proportional historical RWF value. The difference between cash and released value remains available as an FX difference and never changes stored purchase or inventory cost. |
| Shipment payment | Debit an account against a specific recorded charge. Charge reconciliation separates recorded, capitalized, paid and outstanding amounts. A paid charge remains linked to its original shipment. A shipment with payment history requires a coordinated change for charge edits. |
| Transfer | One posting credits and debits two distinct eligible RWF accounts. It affects cash balances only. |
| Reversal | A compensating posting swaps the original accounts, checks available funds and account eligibility, and retains the original record. Eligible finance types are expenses, supplier payments, shipment payments and transfers. The POS endpoint retains its own checks before calling the same compensation logic. |

The API checks owner JWT, session and write origin. Actors come from the authenticated session. Transaction-scoped locks serialize procurement and its financial settlements. Account rows are locked in ID order before balance checks. Postings, business details and audits commit together. Mutations with supplied retry keys are checked against the original request. An expense submitted without a retry key receives a new server reference. Clients should reuse one `Idempotency-Key` across retries.

## Owner APIs

All paths are under `/api/v1`.

| Resource | Endpoints |
| --- | --- |
| Accounts | `GET/POST /financial-accounts`, `GET/PATCH /financial-accounts/{id}`, `POST /financial-accounts/{id}/archive`, `GET /financial-accounts/{id}/reconciliation` |
| Categories | `GET/POST /expense-categories`, `PUT /expense-categories/{id}` |
| Expenses | `GET/POST /expenses`, `GET /expenses/{id}`, `GET /expenses/category-totals` |
| Optional receipts | `GET/POST /expenses/{id}/receipts`, `GET /expenses/{id}/receipts/{receiptId}`. Creation also accepts an optional multipart receipt beside an expense JSON part. |
| Ledger and transfers | `GET /finance/transactions`, `GET /finance/transactions/{id}`, `POST /finance/transactions/{id}/reverse`, `POST /finance/transfers`, `GET /finance/reconciliation` |
| Suppliers | `GET /suppliers/{id}/obligations`, `GET/POST /suppliers/{id}/payments`, `GET /suppliers/{id}/payments/{paymentId}` |
| Shipments | `GET /shipments/{id}/charge-balances`, `GET/POST /shipments/{id}/payments`, `GET /shipments/{id}/financial-reconciliation` |
| Claims | `GET/POST /shipments/{id}/claims`, `POST /shipments/{id}/claims/{claimId}/decision`, `POST /shipments/{id}/resolutions` |

Expense history filters by date, account, category, text and reversal state. Transaction history filters by kind, date, account and reversal state. Pagination has a stable date and ID sort. Expenses retain the category name used at posting. Category totals group by stable ID and exclude reversed expenses. Attachments are optional at creation and afterwards, including PDF and supported images up to 2 MiB. [OpenAPI contract](../backend/spring/openapi.yaml)

## Shipment discrepancies and inventory

Exposure follows the receipt's captured supplier and freight costs. Damage uses damaged supplier cost plus its share of held freight. Shortage uses its share of held freight. Submitting or accepting a claim creates no cash or payable entry. An accepted claim may be compensated in partial amounts through RWF cash receipts or credits against the original purchase. Both exposure and accepted value cap compensation. Loss is an explicit action capped by remaining exposure, after a pending claim has been decided and any acceptance settled. Damage held and units missing stay physically distinguishable. Settlements do not remove available stock or add landed cost.

A usable return for an archived product keeps the sale and refund linkage and records `ARCHIVED_HELD`. The product remains archived, with zero sellable units and no stock valuation restoration. Held disposition and later recovery need a controlled workflow. Completed receipt corrections also remain open. They require compensating receipt and quantity events, recomputation of reservations, allocation differences, and checks against later sales, claims and settlements before posting any stock or cost adjustment. Historical receipt rows and movements must be preserved.

The read-only finance summary reconciles sales net of returns, collections, refunds, customer debt, COGS, gross profit, operating expenses, supplier and shipment obligations, discrepancies and posting links. Account reconciliation separates cash categories and reversals. Gross profit uses recognized sales and captured COGS. Cash collections and transfers are separate measures.

## Migration and cutover

| Legacy SQLite source | PostgreSQL mapping |
| --- | --- |
| `accounts`, `money_transactions`, `money_reversals` | Preserve account and posting IDs, native currency, actor, timestamps and references. Load existing postings and linked compensating rows directly. Preserve old opening balances as postings. Never rerun checkout, expense or payment handlers. |
| `operating_expense_entries`, `expense_receipts`, expense metadata | Map category IDs and historical labels, date, description, payee, references and optional attachments. Split shipment-linked expense rows from ordinary expenses. Retain original file IDs and hashes. |
| Supplier settlements | Preserve payment IDs, exact RWF cash, historical value released, original-currency units discharged, and purchase links. Validate outstanding RWF and native amounts against the source. |
| Shipment settlements, claims and resolutions | Preserve recorded cost and original receipt IDs. Carry over each actual payment or compensation once. Verify held versus capitalized amounts, paid obligations, credits and loss limits. Classify history requiring unsupported foreign or physical resolution before import. |
| Retail payments, refunds and stock movements | Keep V6 mappings and original actor, product and receipt references. Check unchanged inventory on load, net receivables, refunds and per-account closing balances. |

Use read-only synthetic or disposable SQLite snapshots and a disposable PostgreSQL database. Load rows with original identities, then compare references, historical balances, supported transaction totals and unchanged stock at a common cutoff. A full row-level rehearsal must cover cross-currency cases, customer and supplier histories, archived returns, stock/cost links, and all historical shipment dispositions.

The first Spring rollout uses RWF accounts only. Native USD/CNY account balances, cross-currency transfers and fees, native shipment claims, shortage principal closure, claim settlement reversal and physical damage recovery require additional policy and implementation. A shortage with no recorded freight exposure can remain pending for that workflow. These limits do not change the SQLite features available today.

Added V7, finance DTOs and API, finance transaction workflows, discrepancy resolution and exact payable calculations. Updated the V6 posting service, procurement guards, archived-product return handling, authorization, integration tests, OpenAPI, and migration documentation. No files were removed. Next, extend native-currency and correction workflows and rehearse full historical reconciliation before considering cutover.

## Verification

- All 22 Maven tests passed against disposable PostgreSQL 18.4. Five new HTTP scenarios cover receipt-optional expenses, transfers and archive rules, supplier allocations, shipment claim decisions and resolutions, and returns for archived products. Existing POS, refund and payment reversal tests passed.
- A disposable V6-to-V7 upgrade preserved the existing RWF 500 posting and the stock balance of two units valued at RWF 101. The upgrade generated no additional financial postings.
- A separate row-level rehearsal read a synthetic SQLite snapshot in read-only mode and loaded the existing rows directly into disposable PostgreSQL. Four posting IDs, the reversal link, actor, category, business date and RWF 70 closing balance matched. Stock stayed at the original quantity and value. The fixture covers opening balances, expenses and reversals.
- All 41 Vitest tests, frontend lint, the production build and the SQLite API smoke test passed. OpenAPI parsed with all 30 finance operations matching the controller.
- Docker Compose configuration validated. Container execution was blocked because the Docker engine was unavailable.
