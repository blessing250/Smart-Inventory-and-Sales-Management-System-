# BizFlow Jewelry architecture migration plan

## Architecture decision

Keep Next.js as the React frontend during the migration. It already provides routing and working feature screens. Reuse TypeScript contracts, Tailwind styling and browser clients. A same-origin reverse proxy will route the final business API to one Spring Boot process. Consider Vite after cutover if the remaining Next.js runtime overhead warrants it.

Spring Boot will own authentication, authorization, validation, business transactions, reporting and audit. Organize it as a Maven modular monolith by auth, catalog and inventory, purchasing and shipments, sales and orders, contacts, finance and expenses, reports, and settings. Use Jakarta validation on DTOs, transactional services for writes, and JDBC for ledger-critical or report SQL. Use Spring Data JPA for suitable aggregates and set Hibernate to validate schema. Publish OpenAPI contracts as each module is added.

Use Java 25, Spring Boot 4.2.0 and Maven 3.9.x for the foundation. Verify dependency resolution with Maven. Local PostgreSQL 18 is the development target. [Spring Boot release](https://spring.io/blog/2026/11/19/spring-boot-4-2-0-available-now/) · [System requirements](https://docs.spring.io/spring-boot/system-requirements.html)

## Implementation order

| Milestone | Scope and acceptance | Complexity and dependencies |
| --- | --- | --- |
| A. Verify | Record the live driver, technologies, existing regression coverage and operational limits. | Low. Inspect source, local configuration and tests. |
| B. Foundation | Build an isolated Spring API with health endpoints, Flyway bootstrap, least-access defaults and a development Compose definition. Keep existing routing and write authority. | Medium. Maven, Java, and a disposable PostgreSQL database. Docker runtime verification requires an available engine. |
| C. Security | Port owner authorization, recovery, session revocation and offline recovery. Vet cookie and CSRF behavior and migrate the existing bcrypt hash. | High. Spring Security, private signing keys, SMTP staging and incident-recovery checks. |
| D. Business parity | Port catalog and contacts first, then purchasing, receiving and stock, POS and returns, finance and expenses, and settings and history. Each module needs validation, idempotency, audit and transaction parity. | Very high. Requires a verified contract and versioned business schema. Validate with concurrent PostgreSQL tests. |
| E. Data reconciliation | Dry-run verified SQLite snapshots into isolated PostgreSQL. Produce a signed reconciliation result before an approved maintenance window. | High. Requires actual data authorization for any production run and verified backups. |
| F. Frontend and cutover | Exercise React against Spring in staging. Freeze old writes, run final import, validate parity and direct the proxy to Spring as the authoritative API. | High. Requires accepted security, business and recovery gates. |
| G. Charts and reports | Add Recharts with Kigali date ranges, data from Spring and accessible empty states. Port receipts and exports after functional and visual comparisons. | Medium to high. Evaluate Apache POI and Apache PDFBox licensing and compatibility before selecting versions. |
| H. Deployment | Build images with pinned versions, isolated database networking and durable storage. Verify HTTPS, grace periods, logs, monitoring, backup encryption and restore on the approved host. | High. Requires Docker runtime, staging environment and operator approval. |

## Authentication and transaction contracts

- Use Spring Security to authenticate short-lived signed JWTs with issuer, audience, expiry, role and a server-tracked session ID. The isolated staging adapter keeps its bearer token in memory and sends it explicitly through a same-origin proxy. Spring rejects cross-origin mutations and retains CSRF protection outside the bearer namespace. A future cookie transport or refresh feature requires a separate CSRF and rotation review.
- Carry forward only the existing owner identity and bcrypt hash. Enforce role `OWNER` in Spring and map the legacy `admin` row explicitly. Require a new sign-in at cutover. Preserve generic recovery responses, hashed one-time tokens, 30-minute expiry, rate limits, verified SMTP and an audited restricted operator reset. Invalidate outstanding recovery tokens at cutover.
- Preserve integral RWF, USD cents and CNY fen, captured fixed-point rates, and exact rounding in Java using checked integer arithmetic and `BigInteger` or explicit `BigDecimal` scale and rounding. Keep account debits, stock, audit and retry records atomic. Preserve separate FX, supplier offsets, compensations, and expense classification. Ordinary expenses continue to accept an absent receipt.

## Data and acceptance

Validate the source version, integrity and foreign keys. Back up the source using the SQLite online mechanism and verify restoration. Apply the PostgreSQL Flyway business schema to a fresh destination. Use the existing exporter to validate extraction and transformation, then map its output into the Flyway-managed destination. Preserve IDs, dates, references, binary attachments and foreign-key order. Keep captured rates unchanged. Report counts and checksums for audit events, stock quantities and valuation, sales and purchase totals, open customer and supplier balances, and account balances by native currency. Compare per-account and per-record figures to prevent offsetting errors. Run the full test suite and check foreign keys before acceptance.

Preserve the active Vitest cases. Add Spring Boot JUnit tests, PostgreSQL integration tests with Testcontainers or an isolated local instance, and browser tests against the staged Spring backend including phone, tablet and desktop. Exercise duplicate and parallel checkout, partial receiving, damaged and missing stock, payment and expense reversals, reports, owner recovery and backup restoration. Compare A4 portrait receipts, landscape reports, titles, repeating headers, page numbering and matching PDF/Excel totals.

## Cutover and rollback

Use an approved maintenance window and a reviewed operator runbook. Stop existing writers, verify a final snapshot and reconcile imported data before reopening writes. Start Spring against the approved PostgreSQL database with a limited runtime role. Keep schema migration and backup privileges separate. Point the reverse proxy to Spring only after checks pass. Keep the prior app and backup for rollback. If Spring has accepted transactions, stop writes and reconcile those transactions before restoring the old write path. Store encrypted off-server PostgreSQL backups and perform a restore drill before approval.

## Milestone results

### A. Technology verification

- **Completed.** Reviewed installed dependencies, the API and authentication paths, database code, deployment files and effective driver selection. Recorded the gaps and the retained frontend decision on `migration/spring-postgres-foundation`.
- **Files.** [Technology assessment](TECHNOLOGY_STACK_ASSESSMENT.md), this plan, and links in the app README.
- **Verification.** The effective Next.js environment selects SQLite. The live writer remains Next.js. Installed tools include Java 25.0.4.1, Maven 3.9.14 and PostgreSQL 18.4. The Docker CLI could not connect to its engine.
- **Business, data and security.** Existing files and business behavior were preserved. No business records were used for database testing. The audit checked configuration keys without disclosing secrets.
- **Open work.** The verified architecture still needs the Java API, authentication and data migration. The next milestone was the isolated Spring foundation.

### B. Spring foundation

- **Completed.** Added Spring Web, Security, Validation, JDBC and Flyway. Liveness and readiness are the only enabled API routes. The initial migration creates a schema marker and Flyway history.
- **Files.** [Maven project](backend/spring/pom.xml), [source and migration](backend/spring/src/main), [tests](backend/spring/src/test), [OpenAPI](backend/spring/openapi.yaml), [Dockerfile](backend/spring/Dockerfile), [Compose](backend/spring/compose.yaml), and [development guide](backend/spring/README.md).
- **Verification.** `mvn -B -ntp verify` passed four tests with the PostgreSQL integration test enabled against a disposable PostgreSQL 18.4 database. Flyway applied version 1, HTTP probes returned 200, and a business URL and an unauthenticated write returned 403. The test database was removed. `pnpm lint`, all 41 Vitest tests, and `pnpm build` passed. `docker compose config --quiet` passed with a synthetic secret.
- **Business, data and security.** Next.js still owns inventory, sales, expenses, authentication and exports. No migrations ran against business data. Spring denies routes other than GET probes and checks the disposable database name and absence of business tables before running Flyway.
- **Open work.** Docker image builds and container execution need a running Docker engine. Spring authentication, Flyway business schema, React integration, Recharts, Java exports and production cutover remain pending.
- **Next milestone.** Implement Spring Security JWT and owner recovery parity against disposable PostgreSQL, then verify session revocation and restricted operator recovery before routing traffic.

### C. Owner authentication and recovery

- **Completed.** Added the Spring auth module, Flyway V2, owner REST endpoints and an offline operator command. The staging browser now uses the shared client introduced after this milestone. [Staging client](frontend/staging/client.ts)
- **Verification.** Maven passed all six tests with disposable PostgreSQL 18.4. The HTTP integration exercised bcryptjs hash compatibility, generic login and recovery responses, expired and incorrectly signed JWTs, incorrect audience, logout, authorization, recovery expiry, delivery failure, concurrent token consumption, rate limits, old-password rejection and revocation of earlier sessions. It verified persisted audit events for reset, logout and offline recovery. All 41 existing Vitest tests, ESLint and the Next.js production build passed. Compose configuration validated with synthetic secrets.
- **Business and data.** Spring has one owner slot and does not serve business APIs. Java tests use a disposable PostgreSQL database and a synthetic bcryptjs hash. No existing SQLite owner or business records are read or transferred.
- **Security.** Each ten-minute JWT requires an active persisted session. Logout revokes one session, and password reset or offline recovery revokes all owner sessions. SMTP verifies the server identity and uses TLS. Recovery stores only SHA-256 digests and uses a generic response for valid requests. Application rate limits are per process, so staging must also verify proxy limits.
- **Open work.** Verify delivery with an approved SMTP provider and HTTPS staging. Validate the staged browser proxy and operator console workflow, then approve account import and signing-key handling. Production authentication and business routing remain with Next.js.
- **Next milestone.** Define the Flyway-managed business schema and port the first read-only catalog contracts, then add transactional inventory writes and compare them against the current regression cases.

### D1. Catalog and safe cleanup

- **Completed.** [Technology compliance, cleanup inventory, catalog API and migration mapping](docs/SPRING_CATALOG.md). Flyway V3 adds the catalog family, item, image and audit tables. Product identity stays independent per SKU.
- **Preservation.** Existing Next.js pages, routes, reports and SQLite service remain authoritative. Data, auth routing and purchasing, sales and finance behavior are outside the catalog write path.
- **Security.** Catalog service methods use transactions, owner JWT role checks, cross-origin mutation rejection and database-backed session validation. Catalog fields exclude stock quantities and valuation.
- **Next milestone.** Add an audited inventory ledger and reconcile stock quantities and valuation using disposable source snapshots before testing the Spring UI integration.

### D2. Inventory ledger and counts

- **Completed.** [Flyway V4 and the owner-only Spring inventory API](docs/SPRING_INVENTORY.md) cover opening balances, documented adjustments, versioned counts, controlled reversals and read-only reconciliation. Stock writes serialize per product, and catalog archiving shares the same lock.
- **Verification.** Nine Maven tests passed, including five PostgreSQL integration cases. All 41 Vitest tests, lint, the Next.js build and a synthetic SQLite API smoke test passed. Compose configuration validated and Docker execution was blocked.
- **Preservation.** SQLite remains the only live inventory writer. The milestone used dedicated disposable databases and kept the current stock routes, recovery tooling and historical migrations.
- **Open work.** Historical valuation replay still needs verified source evidence. Purchase, receiving, sales and returns are pending Spring integration. The read-only reconciliation endpoint reports differences for operator review.
- **Next milestone.** Integrate purchasing and partial shipment receiving with captured costs, eligibility checks and the stock ledger.

### Milestone 5

Flyway V5 adds purchasing, shipment reservations and partial receipts to Spring Boot. Usable receipts post exact landed cost through the existing inventory ledger. Procurement APIs use the owner session and retain an audit trail. Next.js and SQLite remain the sole live business stack. [Procurement implementation, verification and migration mappings](docs/SPRING_PROCUREMENT.md)

The next milestone should add coordinated receipt corrections and financial discrepancy resolution, followed by a migration rehearsal with disposable snapshots.

### Milestone 6

Flyway V6 adds POS and online checkout, customer receivables, exact COGS, auditable returns and refunds, and reusable financial account postings. Spring shares its existing stock ledger across procurement and sales. Next.js and SQLite remain the sole live stack. [Sales architecture and migration checks](docs/SPRING_SALES.md)

Milestone 7 extends the account posting boundary for the remaining finance flows. Coordinated receipt corrections and the disposable data migration rehearsal remain prerequisites for cutover.

### Milestone 7

V7 extends the existing financial ledger for RWF expenses, supplier and shipment settlements, transfers, reversals and shipment compensation. Discrepancy credits and approved losses preserve their receipt references. The new finance reconciliation is read-only. Native account currencies, coordinated corrections, and full historical reconciliation remain cutover work. [Financial operations and migration mapping](docs/SPRING_FINANCE.md)

### Milestone 8

V8 through V10 add native currency posting, a constrained append-only receipt correction, and owner reporting and browser sessions for staged React integration. Finish workflow parity, native reconciliation acceptance, Docker verification, and historical exception review before cutover. [Milestone 8](docs/SPRING_MILESTONE_8.md)

### Milestone 9

V11 adds import idempotency, business profile and legacy audit mapping. Staging includes mixed checkout, guided spreadsheet import and shipment discrepancy actions. A local PostgreSQL restore drill and expanded historical rehearsal ran on synthetic data. Production cutover still requires full owner workflow acceptance, reconciliation of representative protected history, verified container runtime and an off-host restore drill. [Milestone 9 gate report](docs/SPRING_MILESTONE_9.md)

### Milestone 10

Staging readiness verification covers synthetic browser workflows, historical reconciliation and an encrypted local restore. Production approval depends on representative historical reconciliation, an approved HTTPS deployment, real SMTP delivery and an independent backup recovery drill. [Milestone 10 gate report and cutover runbook](docs/SPRING_MILESTONE_10.md)
