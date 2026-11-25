# Spring product catalog migration

## Technology compliance and cleanup

| Layer | Approved technology | Verified implementation | Status |
| --- | --- | --- | --- |
| Frontend | React and TypeScript | React and TypeScript in Next.js, with pages in [frontend](../frontend) and route entries in [app](../app) | Retained for feature parity. Reassess frontend-only Next.js after the Spring cutover. |
| UI | Tailwind CSS | [Global styles](../frontend/globals.css), [PostCSS](../postcss.config.mjs), shared components, product forms and dashboard | Retained |
| Backend | Java, Spring Boot, Spring Web, Jakarta Validation, Maven | [Spring Maven module](../backend/spring/pom.xml) and [catalog package](../backend/spring/src/main/java/com/bizflowjewelry/backend/catalog). JDBC is used for explicit catalog SQL. | Catalog implemented in staging. Other business services remain in Next.js. |
| Security | Spring Security and JWT | [Existing Spring auth](../backend/spring/src/main/java/com/bizflowjewelry/backend/auth) and [security chain](../backend/spring/src/main/java/com/bizflowjewelry/backend/foundation/ApiSecurity.java) reused | Staging |
| Database | PostgreSQL and Flyway | [V3 catalog migration](../backend/spring/src/main/resources/db/migration/V3__product_catalog.sql) | Staging PostgreSQL. SQLite remains authoritative. |
| Charts | Recharts | The [pnpm manifest](../package.json) and lockfile have no Recharts dependency. | Pending. Add it when Spring exposes Kigali-filtered sales, gross profit, operating expense and inventory series. Validate responsive layouts and compare totals with authoritative reports. |
| Reports | PDF and Excel | [Existing PDF layout](../backend/reports/business-pdf.ts) and [Excel/PDF routes](../backend/api/reports/export/route.ts) | Retained. Evaluate Java report libraries during report migration, compare A4 layout, green/gold styling and report totals. |
| Deployment | Docker and Compose | [Spring image](../backend/spring/Dockerfile) and [development Compose](../backend/spring/compose.yaml) | Foundation only. Frontend container, HTTPS proxy, hosting, encrypted backups and monitoring are pending. |

Two redundant `runtime` exports were removed from the legacy recovery and readiness implementation modules. Next.js reads the declarations from their `app/api` route entries. No files or packages were removed in Milestone 3. The route entry wrappers are needed for Next.js routing. The Spring staging adapter is an intentional migration asset. Review found no confirmed unused UI component, CSS rule, test fixture or package safe to remove in this milestone. Keep NextAuth, SQLite, Node business handlers, PDF and Excel generators, tests, recovery tools and export scripts until equivalent Spring behavior and rollback have been accepted. Both the existing and Spring catalog modules are intentionally present for comparison on separate data.

## Schema and migration mapping

V3 adds four tables to the existing isolated `bizflow_foundation` schema. V1 and V2 are unchanged.

| SQLite source | PostgreSQL target | Mapping and checks |
| --- | --- | --- |
| `product_families` | `catalog_families` | Keep text IDs and names. A unique lowercased index rejects duplicate names. The legacy source lacks family timestamps, so set both timestamps to a documented import time unless authoritative timestamps can be recovered. |
| `products` | `catalog_products` | Preserve IDs, SKUs, names, category labels, descriptions, supplier labels, family IDs, and size, color, material and design. Preserve selling price and map `purchase_price` to `estimated_unit_cost` in whole RWF. Map `minimum_quantity` to `reorder_threshold`. Copy archived and created timestamps. Where the source lacks an update timestamp use the creation timestamp or the later archive timestamp. |
| `product_images` | `catalog_images` | Preserve the product ID, content type and exact bytes. Store in `bytea` with the product FK and a 2 MiB database limit. |
| Legacy audit rows | Future audit import | Preserve source events and actor links in a separate accepted migration. `catalog_audit` records staging catalog changes with an owner FK and exactly one product or family FK. |
| Stock quantities, valued inventory and historical product references | Next inventory and business migrations | Preserve IDs for all later FKs. Reconcile `quantity`, `stock_value` and historical references against the source separately. Catalog writes have no quantity or stock-value fields. |

Product SKU uniqueness uses a PostgreSQL unique index on `lower(sku)`. Preflight casing and collation differences before importing. The product indexes cover family, normalized category, active-name order and creation order. Preserve every variant as its own product. Validate nullable family FKs and compare the original text labels during dry runs. Parse timestamp offsets explicitly, agree on a fallback for ambiguous legacy timestamps and retain the audit evidence.

Take and verify an authorized SQLite snapshot before any future import. Inventory source and destination counts for families, all products, archived products and images. Import families, then products and images in a transaction. Review lowercased SKU and family-name conflicts, numeric ranges, foreign keys, sample timestamp equivalence and image hashes before acceptance. Quarantine unexpected source records for review and preserve the original snapshot. After the stock ledger lands, reconcile current and historical quantities and valuation before any approved cutover. This milestone uses fixtures only. The SQLite source and existing business routing remain the rollback path.

## Staging API

Every endpoint requires the active owner bearer JWT from Milestone 2. Mutations also check browser origin. Spring uses bearer authentication with no ambient auth cookie and does not change the current NextAuth sign-in.

| Method and path under `/api/v1` | Behavior |
| --- | --- |
| `POST /products` | Create a catalog record with no inventory effect. |
| `GET /products` | Zero-based pagination, literal query search, category and family filters, active/archived/all, and stable name/SKU/newest sorting. |
| `GET /products/{id}`, `PATCH /products/{id}` | Read and patch catalog metadata. |
| `POST /products/{id}/archive` | Idempotently archive and keep the original ID and image. Archived items reject edits. |
| `GET /product-families`, `POST /product-families` | Paginate and create families. |
| `GET /product-families/{id}`, `PATCH /product-families/{id}` | Read and rename one family without changing its links. |
| `PATCH /products/{id}/family` | Assign an existing family or explicitly unlink with `{"familyId":null}`. |
| `PUT /products/{id}/image`, `GET /products/{id}/image` | Verify the multipart image type and size, replace the product image, or download it. |

Product, family and image writes commit with their audit event. Database uniqueness is the enforcement point for concurrent duplicate SKUs and family names. Future inventory rules must check stock and pending transactions before a production archive is accepted.

## Verification

- Maven passed **7 tests**, including **3 HTTP/PostgreSQL integration tests**. The catalog test exercised Flyway V3, bearer rejection for missing, expired, tampered and revoked sessions, family associations, variant independence, literal search and filters, pagination, create/update/archive, concurrent duplicate SKUs, image round-trip, foreign-key integrity, and rollback when an audit insert fails.
- All **41 Vitest tests** passed. ESLint, the Next.js production build, TypeScript unused-symbol checks, and the disposable production API smoke test also passed. Next.js smoke covered owner access, purchases, shipments, stock, sale retries, dashboard and exports.
- Docker Compose configuration validated. **Container execution is blocked** because the Docker engine was unavailable. No business data was migrated and no production routing changed.

## Next milestone

Implement an append-only stock ledger, audited stock adjustments and physical counts. Reconcile quantities and stock value to existing inventory, add concurrent transaction tests and preserve historical links through purchasing, sales and returns. Retire legacy code only after cross-stack parity and approved cutover.
