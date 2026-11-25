# Spring inventory ledger

Milestone 4 adds audited stock operations to the isolated Spring PostgreSQL service. The existing Next.js application and SQLite database remain the sole authority for business inventory.

## Flyway V4

| Table | Responsibility and constraints |
| --- | --- |
| `inventory_balances` | One row per catalog product at the single stock location. Stores available quantity, whole-RWF value, version and update time. Quantity and value are nonnegative. Zero quantity implies zero value. Catalog registration creates no stock row or movement. |
| `inventory_movements` | Append-only UUID ledger. Holds the operation reference, reason, owner FK, timestamp, signed quantity and value deltas, before and after balances, and product version. A trigger blocks updates and deletes. Unique indices enforce one opening, one operation per reference, one movement per product version and one reversal per original. Reversal FKs require the same product. |
| `inventory_counts` | Drafted and confirmed physical observations. Stores expected quantity/version, observed quantity and generated difference. Stores the drafting and confirming owner and dates. A nonzero confirmed difference requires a same-product movement. A zero-difference count keeps its audit history without creating a movement. |

Time and product indices support history filters. Quantity is capped at one billion units and value at the JavaScript safe integer limit in whole RWF. These caps protect the API representation and avoid silent truncation.

## Transaction and valuation rules

Every stock write locks the catalog product row before reading or updating stock. Catalog archiving uses the same lock and rejects positive stock. Duplicate references, insufficient stock and ledger insert errors cause a transaction rollback. The ledger stores the authenticated owner as actor. Operators cannot set available stock directly through catalog or inventory endpoints.

An opening provides both the quantity and the documented total value. It is eligible only before the first movement. Manual increases with existing stock and all outgoing deductions use the legacy proportional rule, rounded half up in whole RWF. An increase from zero uses the catalog estimated unit cost, as the legacy manual-adjustment fallback did. The calculation uses checked integers and `BigInteger` multiplication before rounding. The service keeps the catalog estimate separate from current stock valuation.

Reversals are restricted to the latest non-reversal movement whose captured after-balance matches current stock. They post the exact inverse of the recorded quantity and value. The original row stays intact. Use a documented current adjustment for a historical discrepancy that cannot safely be reversed.

The count form should use the balance version from the moment the owner begins counting. Drafting stores that version with expected and observed quantities. Confirmation fails if stock has changed, even if quantity later returns to the same number. Repeating a confirmed request returns the existing count. Drafts and confirmations are recorded on the count row.

`DAMAGE_OUT` and `MISSING_OUT` take units out of previously available stock. The unavailable view reports recorded deductions of each kind with reversals excluded. These are historical dispositions, not additional on-hand balances. Shipment losses were never available stock. Waiting-for-receipt quantity is unknown until purchasing and receiving are wired. There are no automatic supplier credits, financial write-offs, purchase receipts or sales postings.

## Owner-only REST API

Each route uses the existing active-session JWT. The owner identity comes from Spring Security. Mutations also enforce the trusted browser origin.

| Endpoints under `/api/v1/inventory` | Use |
| --- | --- |
| `GET /balances`, `GET /products/{id}/balance` | Browse available quantity, RWF value and stock version. |
| `GET /movements`, `GET /movements/{id}` | Browse stock history, with product, movement kind, literal search and Kigali date filters. |
| `POST /products/{id}/opening` | Post an explicit opening using `quantity`, `valueRwf`, `reference` and `reason`. |
| `POST /products/{id}/adjustments` | Post `INCREASE`, `DECREASE`, `DAMAGE_OUT` or `MISSING_OUT` using `type`, `quantity`, `reference` and `reason`. |
| `POST /products/{id}/counts`, `POST /counts/{id}/confirm` | Draft with `expectedVersion`, `observedQuantity`, `reference` and `reason`, then confirm. |
| `GET /counts`, `GET /counts/{id}` | Browse observations and linked adjustments. Filter by product, pending or confirmed status, search and Kigali count date. |
| `POST /movements/{id}/reverse` | Post an eligible inverse using a new `reference` and `reason`. |
| `GET /products/{id}/unavailable` | Read previously available stock recorded as damaged or missing. |
| `GET /products/{id}/reconciliation` | Compare cached quantity, value and version with ledger totals, opening movements, movement chain and confirmed count links. Includes disposition totals. Read-only. |

List endpoints use zero-based pages with stable ordering and a size cap of 100. Date ranges are inclusive business dates in Africa/Kigali. Conflicting operations return 409 and missing records return 404.

## SQLite mapping and dry-run checks

| SQLite source | Planned mapping |
| --- | --- |
| `products.id`, `quantity`, `stock_value`, `purchase_price` | Preserve the catalog ID and estimate mapping. Compare final quantity and value with the replayed ledger before populating the cache. |
| `stock_movements.id`, `type`, `quantity`, `remaining_stock`, `movement_date`, `reason` | Preserve the original UUID where valid. Translate Stock In/Out to signed deltas. Reconstruct before quantity from `remaining_stock - delta` and verify the sequence with SQLite insertion order as the tie-breaker. Preserve timestamp offsets and original actor links. Check UUID compatibility before import and agree on a reversible crosswalk for non-UUID history if needed. |
| `stock_movements.receipt_reference`, `purchase_item_id`, `sale_item_id` | Preserve those exact business references and IDs during receiving and sales ledger work. Do not import them as generic manual corrections. |
| `stock_counts.expected`, `counted`, `movement_id`, `actor_id`, `recorded_at` | Preserve the IDs, quantities and movement links. Legacy counts were confirmed in one action, so map the same historical actor and time to both steps. Derive expected versions from validated movement sequence. |
| `stock_movements.disposition` | Map outgoing Damaged/Missing movements to the corresponding unavailable disposition. |
| Shipment receiving and manifest records | Preserve original event, shipment and purchase-line IDs. Keep damage, missing and awaiting-receipt records separate from available stock. |
| `users.id`, `audit_log` | Preserve or explicitly crosswalk existing owner and actor IDs before applying FKs. Preserve audit events and original links. |

SQLite movements do not carry a universal per-movement value delta. Use verified purchase/receiving, opening and sale cost evidence for replay. Investigate gaps and report them for approval. Never guess historical landed cost or derive it by dividing today's inventory value. Verify linked business records and reconcile quantity, valuation and movement chains against a protected snapshot. Keep that snapshot and existing routing for rollback. Test fixture values and counts exercise matching and mismatched results. No live data import or dual writes took place.

Future purchasing, shipment, sales and returns services should call dedicated transactional inventory operations with validated business references and captured costs. They should share the existing per-product lock and ledger posting path. Multi-line operations need a deterministic product lock order before they are enabled.

## Milestone verification and files

- Added [Flyway V4](../backend/spring/src/main/resources/db/migration/V4__inventory_ledger.sql), the [inventory service and API](../backend/spring/src/main/java/com/bizflowjewelry/backend/inventory), and [PostgreSQL inventory tests](../backend/spring/src/test/java/com/bizflowjewelry/backend/inventory/InventoryPostgresTest.java). Updated the Spring owner security rules, catalog archive guard, [OpenAPI](../backend/spring/openapi.yaml), setup and migration documentation. No files, dependencies or legacy routes were removed.
- Maven passed **9 Java tests**, including **5 HTTP/PostgreSQL integration tests**, on a disposable PostgreSQL database. The new inventory tests covered exact proportional valuation, openings and duplicates, concurrent oversell rejection, rollback, immutability, stale and zero-difference counts, dispositions, reversal, reconciliation, archive protection and unauthorized, expired and revoked session rejection.
- All **41 Vitest tests**, ESLint and the Next.js production build passed. The existing API smoke test passed on a disposable SQLite database. Its synthetic purchase and sale fixtures validated signed movement mapping, preserved links and final quantity/value.
- Docker Compose configuration validated. Container execution is **blocked** because the Docker engine was unavailable.

## Next milestone

Integrate purchasing and confirmed shipment receiving with the ledger. Preserve captured costs, partial receipt references and the distinction between damage, shortages and usable units. Complete historical valuation reconciliation before planning an approved cutover.
