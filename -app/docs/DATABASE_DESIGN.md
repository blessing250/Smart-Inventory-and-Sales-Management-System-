# Database design

The runtime uses SQLite and Node's built-in driver. Versioned SQL lives in `backend/database/business-schema.ts`. The migration runner enables foreign keys, serializes schema changes and uses SQLite's user version to record applied migrations.

File databases use WAL and full synchronization. Writes use immediate transactions and connections have a five-second busy timeout. Production requires an absolute database path outside the application directory and an explicit [upgrade to a new copy](BACKUP_AND_RESTORE.md) for older databases.

The isolated Spring PostgreSQL catalog is versioned by Flyway V3. See the [catalog migration mapping](SPRING_CATALOG.md) for schema constraints, preserved identifiers, data validation and rollback.

Flyway V4 adds the isolated Spring inventory balance, append-only movement ledger and physical counts. See the [inventory ledger and SQLite mapping](SPRING_INVENTORY.md).

Flyway V6 adds the Spring sales schema, durable RWF posting foundation, and read views for sales receivables and account balances. [Sales tables, constraints and source mappings](SPRING_SALES.md)

Flyway V7 extends the same financial posting table and adds linked operating expense, supplier settlement, shipment payment and discrepancy records. The account balance view remains the single source of truth. [Finance tables and source mappings](SPRING_FINANCE.md)

Flyway V8 through V10 preserve native posting legs, linked receipt corrections, sale category snapshots and hashed browser session renewal. [Milestone 8 data model and rehearsal](SPRING_MILESTONE_8.md)

Flyway V11 adds catalog import references, the business profile and its audit history, and a destination for legacy audit events. Imports preserve existing stock and run through the catalog transaction. [Milestone 9 historical mapping](SPRING_MILESTONE_9.md)

Migration 24 creates `password_resets` with at most one row per owner, a unique SHA-256 token digest and expiration in Unix milliseconds. Successful recovery changes the existing bcrypt hash, deletes the reset row and appends `owner.password_reset` to the audit log in one transaction. NextAuth verifies an account stamp derived from the current email and bcrypt hash. A password or account-email change invalidates earlier sessions, including tokens created before stamps were introduced.

| Table | Fields and constraints |
| --- | --- |
| users | ID, name, unique case-insensitive email, password hash, role and creation date. |
| products | ID, unique case-insensitive SKU, name, category, description, selling price, opening or estimated unit cost, available quantity, stock value, reorder threshold, supplier label, timestamps and archive date. Stock and value are nonnegative. |
| product_families | ID and case-insensitive unique name. Products opt in through a nullable family FK and keep separate SKU, size, color, material, design, inventory and history. |
| product_images | Product primary/foreign key, supported MIME type and image data, limited to 2 MiB. |
| purchases | ID, supplier label, reporting total, original currency, fixed-point rate, invoice reference, dates and actor. |
| purchase_items | ID, purchase and product FKs, ordered quantity, source unit cost in minor units, converted unit estimate and converted line total. |
| shipments | ID, unique tracking reference, agent, stage, date and actor. |
| shipment_expenses | Shipment FK, expense kind and RWF amount. Shipment and kind form the key. |
| shipment_receipt_items | Shipment and purchase line form the key. Unique movement FK, supplier cost and allocated shipment charges preserve receipt costing. |
| shipment_manifests | Shipment FK, origin, destination, expected arrival, notes, estimated charges and locked allocation method. |
| shipment_manifest_lines | Shipment and purchase line form the key. Expected quantities reserve outstanding purchase units. |
| shipment_receiving_events | ID, shipment, globally unique retry reference, normalized request payload, date and actor. |
| shipment_receiving_lines | Event and purchase line form the key. Tracks usable, damaged and missing units, explanation, supplier cost by disposition, charges allocated/capitalized and optional unique movement. Composite FKs require the purchase line to belong to the event's manifest. |
| sales | ID, customer label, payment method, channel, total, sale date, creation date and actor. |
| sale_items | ID, sale and product FKs, quantity, selling price, line revenue and cost at sale. |
| sale_returns | ID, original sale line, quantity, reason, date, revenue and cost credits, refund, refund account, optional movement, actor and unique reference. |
| payments | ID, sale FK, unique payment reference, method, state, amount, date and actor. |
| online_orders | ID, customer label, contact, source, delivery status, order status, unique nullable sale FK, date and actor. |
| online_order_items | Order and product FKs form the key. Quantity and quoted price are fixed when ordered. |
| stock_movements | ID, product FK, product name snapshot, signed direction with positive quantity, after-balance, reason, actor, date and optional purchase or sale line FK. |
| stock_counts | ID, product, expected and physical stock, reason, actor, optional unique movement and date. |
| accounts | ID, unique name, account kind, native currency and active flag. |
| money_transactions | ID, kind, originating and receiving accounts, unique reference, RWF reporting amount, native source and destination amounts, captured conversion rate, fee, released payable, native obligation discharged, realized FX, optional Kigali settlement date, original posting timestamp, actor and business links. |
| shipment_claims | Unique receipt line and discrepancy kind, claimant, reference, evidence notes, original currency, amount, rate, accepted RWF maximum, submission and decision actors and times. |
| shipment_resolutions | Receipt line, discrepancy kind, unique reference, settlement or disposition, amount, units, notes, optional claim/account/movement, payable-native amount, purchase quantity closed, reversal link, actor and timestamp. |
| money_reversals | ID, unique original transaction FK, reason, actor and timestamp. |
| contacts | ID, type, name, phone, email and location. Names may repeat. Sales, purchases and online orders have nullable contact FKs and keep their name snapshots. |
| business_settings | Singleton ID, business name, address, phone, receipt footer, category and channel suggestions, payment display labels and CNY/USD purchase-rate defaults. |
| audit_log | ID, actor FK, action, affected ID and timestamp. |

Indexes cover purchase and sale dates, child line lookup, sale payments, product movement history, purchase receipts and financial history. Unique constraints index SKU, email and payment, shipment and finance references. Completed events have no application delete action.

The schema has one business and one stock location. To add branches, first provision a default branch for existing records, add its key to sales, receipts, movements and stock counts, and split cached stock balances by product and branch. Keep products in a shared catalog. Introduce branch membership checks at the existing server-side authorization boundary before allowing staff access. Historical operations already reference an actor.

RWF reporting amounts are whole francs. USD and CNY unit costs are stored in cents or fen. The exchange rate is RWF per major currency unit multiplied by 1,000,000. Convert each purchase line with integer rounding and preserve the result. Split partial receipt costs using cumulative proportional rounding so receiving a full line consumes the entire original converted cost. Allocate charges across receipt lines using cumulative weights by quantity or supplier value. The total inventory value increases by the exact landed cost. A sale removes its pro rata share of current product value and stores it on the sale line. Gross profit is sale revenue minus captured cost of goods. The daily dashboard estimate also subtracts operating expenses. Currency conversion, inventory cost and expense allocation use integer arithmetic, including intermediate BigInt multiplication.

Available units equal incoming movement quantities minus outgoing movement quantities. The cached product balance and value update in the same transaction as the movement. A physical stock count records its expected and observed numbers and posts only the difference. Damage and missing-stock adjustments have an explicit disposition. A local receipt can carry a unique retry reference. Sales may carry a unique retry key.

Purchase orders have no stock effect. Sale payments post to accounts atomically, and balances are inflows less outflows. A return credits revenue, reduces unpaid debt and refunds any remaining credit. Only usable returns restore the returned cost to inventory. Supplier balances are purchase totals less allocated supplier payments. Transfers and opening balances are excluded from income and expenses. A shipment FK separates capitalized shipment payments from operating expenses. A financial reversal offsets its original posting without deleting it.

## Shipment receiving and reconciliation

Outstanding manifest quantities reserve purchase units across all open shipments. Local receiving and other manifests can use only unreserved quantities. A receipt resolves a manifest line through usable receipt, damage or confirmed shortage. Usable units create a stock movement. Damaged units consume ordered quantity, and a confirmed shortage releases its reservation so replacement goods can arrive later. Both require an explanation. A manifest closes when every planned unit is resolved. Stock counts labeled recorded damaged or missing are cumulative incident counts.

The first event locks actual charges and quantity or supplier-value allocation. Each manifest line receives a deterministic charge budget. Cumulative integer rounding spreads that budget over resolved units, with usable units receiving the first share within a mixed event. The event keeps damaged supplier cost and the uncapitalized share of charges visible. No write-off, supplier credit or change to the payable is posted automatically. The business still records settlement and any accounting adjustment separately. Earlier receipt and sale costs remain unchanged.

## Phase 2 posting policy

Purchase payables are recorded at the purchase rate. A usable receipt capitalizes supplier and freight cost. Damage exposure uses recorded damaged supplier cost and its proportion of uncapitalized freight. Shortage exposure starts with its freight share. The owner may close an unreserved missing quantity and include its historical purchase cost in the loss. That closure removes expected units without changing the payable. A claim creates no cash or payable posting until explicitly applied. A recovery consumes held units and adds a new stock movement. The recovered cost is capped by outstanding exposure. Returning damaged units consumes held quantities and leaves any remaining exposure for resolution.

An accepted claim can settle through one active payable credit or one verified RWF cash receipt. A credit is capped by the eligible purchase balance. For a foreign payable, the owner enters the agreed native credit and the system releases its historical RWF carrying value, within the accepted claim ceiling. An approved loss uses the unresolved exposure and is reported separately from product gross profit and operating expenses. Reversals offset original events and preserve history. A dependent loss must be reversed before its settlement. Stock recoveries and shortage closures used by later receipts require a separate physical correction.

Account balances are native inflows minus native outflows, source-paid exchange fees and refunds, plus eligible cash compensation, with reversed entries excluded. Historical postings without native fields use RWF. RWF reports use captured conversion, with whole francs and rates fixed to millionths. A supplier payment against a foreign purchase records the native obligation discharged, the proportional historical payable released and the settlement-date RWF cash equivalent. Their difference is a realized exchange result, positive for a loss. Historical RWF-only settlements on a foreign purchase are carried forward proportionally at the stored purchase valuation. The final native settlement releases the remaining carrying amount. Cross-currency exchanges record actual source and destination amounts. Only their recorded fee is an operating cost. Opening balances, transfers and exchanges do not count as sales.

POS writes its individual collections and stock movements in one transaction. Collection accounts must be active, denominated in RWF and match the payment method. New checkout retry keys are bound to the request payload. Returns can default to one unambiguous original funded account, or use a different eligible account selected by the owner.

## Forward upgrades

Migration 13 adds manifest and event tables alongside historical receipts. Migration 14 adds optional product families and attributes. Migration 15 copies the contact directory into a schema that permits repeated names, preserves every contact ID, and adds nullable transaction FKs. Historical transactions remain unlinked for explicit owner review. Migration 16 adds settings defaults. Existing databases require opt-in as described in the setup guide.

Migrations 17–21 add claims and resolutions, native cash and FX fields, checkout retry payloads, original-currency credits and optional shortage closure and settlement dates. They preserve existing transaction, stock and receipt rows. Migration 21 replaces a read view so closed quantities are included in reservation and receiving calculations.

Migration 22 adds expense category settings, optional expense detail and retry payloads on `money_transactions`, optional purchase retry fields, and the read-only `operating_expense_entries` view. An expense uses the existing posting and reversal tables. The view includes ordinary expenses, exchange fees and their signed reversals. It excludes supplier settlements, capitalized shipment costs, transfer principal and sale refunds. Categorization changes affect future suggestions while historical postings retain their recorded category.

Migration 23 adds optional `expense_receipts` rows with an expense FK, file name, content type, bytes, digest, actor and timestamp. Files uploaded during posting commit with the expense. Later uploads add only a receipt and audit event. Repeated uploads of the same file to one expense reuse the existing receipt. Reversals preserve the receipt on the original posting.

Quick expense retries use a unique posting reference and compare the validated request and actor. Exact retries return the original ID. Product import confirmation repeats SKU and opening-stock validation inside one write transaction, then uses the same stock-opening operation as individual product creation. Purchase drafts live in browser storage.
