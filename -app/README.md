# BizFlow Jewelry

Owner workspace for a Kigali jewelry import and retail business. The Next.js app supports SQLite and PostgreSQL. Existing installations use SQLite until an operator configures PostgreSQL.

## Code layout

- `frontend/` contains feature pages, components, styles and browser API clients.
- `backend/api/` contains API handlers. `backend/auth/` handles sign-in, sessions and recovery. `backend/database/` holds business transactions, queries and schema migrations. `backend/reports/` builds report data and PDFs. `backend/http/` validates request bodies and uploads.
- `shared/types/`, `shared/validation/` and `shared/finance/` hold the data contracts, input schemas and calculations used across the app.
- `app/` contains Next.js route entry points. `scripts/` contains the backup, owner recovery and PostgreSQL export commands.

See [PostgreSQL and pgAdmin](docs/POSTGRESQL.md) for importing a snapshot, connecting the app, and inspecting the database.

The migration branch contains the [technology assessment](TECHNOLOGY_STACK_ASSESSMENT.md), [architecture plan](ARCHITECTURE_MIGRATION_PLAN.md) and [isolated Spring foundation](backend/spring/README.md).

## Run locally

Install Node.js 24 and pnpm. From this directory, run `pnpm install --frozen-lockfile` and use your private `.env` for local settings. If you’re setting up a new checkout, copy `.env.example` to `.env` and fill in the values below. Next.js gives `.env.local` precedence when it exists.

```dotenv
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generated random secret>
BIZFLOW_OWNER_EMAIL=<owner email>
BIZFLOW_OWNER_NAME=<owner name>
BIZFLOW_OWNER_PASSWORD=<initial password, at least 12 characters and at most 72 bytes>
# Optional. The default is data/bizflow.sqlite relative to this app.
# BIZFLOW_DB_PATH=
```

Run `pnpm dev` and sign in with the configured owner credentials. The first successful sign-in creates the owner and persists the password hash. Remove the initial password from the environment afterward and restart the application. A fresh database initializes on first access.

Use the [backup and restore runbook](docs/BACKUP_AND_RESTORE.md) to upgrade an existing database. Production upgrades require an explicitly migrated, verified copy. Disposable development databases support the `BIZFLOW_ALLOW_SCHEMA_UPGRADE=1` opt-in.

The app uses `BIZFLOW_DB_PATH` for live data. Keep any prototype database files separate. The [assessment](docs/PROJECT_ASSESSMENT.md) describes what needs to be reconciled for an import.

The login page includes **Forgot password?** for the registered SQLite owner. [Account recovery setup](docs/ACCOUNT_RECOVERY.md) covers verified email, SMTP, local testing, and recovery when the registered mailbox is unavailable. Existing databases need the approved migration to schema 24.

## Verify

```sh
pnpm lint
pnpm test
pnpm build
```

- [Requirements](docs/SRS.md)
- [Database design](docs/DATABASE_DESIGN.md)
- [Entity relationships](docs/ERD.md)
- [Phase status and open requirements](docs/IMPLEMENTATION_PLAN.md)
- [Deployment guide](docs/DEPLOYMENT_GUIDE.md)
- [Release gates](docs/PRODUCTION_READINESS.md)

## Business API

The routes below are available to a signed-in owner. Writes return a JSON result or a validation error. Amounts use whole RWF except the original purchase unit price, which uses the selected currency's minor units. Purchase exchange rates are RWF per foreign currency unit multiplied by 1,000,000.

| Route | Operations |
| --- | --- |
| `/api/products` and `/api/products/[id]` | Create and list products, read or edit details, and archive eligible products. |
| `/api/products/[id]/image` | Read or upload a photo. Upload uses multipart form data with an `image` field. |
| `/api/products/import` | Preview or confirm up to 200 validated product rows from the browser. Explicit stock opening requires a positive cost. |
| `/api/stock` | List stock and movement history. POST records an adjustment. PUT records a physical count and checks its expected quantity. |
| `/api/purchases`, `/api/purchases/receive` | Create and list purchase orders. Receive confirmed locally received quantities by purchase line. |
| `/api/shipments` | List shipments, create manifests, dispatch, or `record` distinct receiving events with usable, damaged and missing quantities. The first event takes actual charges and the allocation method. Legacy shipments keep their original `receive` operation. |
| `/api/shipments/reconciliation` | List damage and shortage cases, optionally by shipment. Submit and decide claims, apply credits, record verified compensation, restore or return damaged goods, approve losses and reverse eligible financial resolutions. |
| `/api/sales`, `/api/sales/returns`, `/api/sales/receipt?id=…` | Create and list sales, record and list returns, and download PDF receipts. Checkout accepts optional account-specific `payments` and requires a `request_key` when they are supplied. |
| `/api/orders` | List online orders and send create, confirm, cancel or delivery actions. |
| `/api/payments` | List or record completed customer payments against a sale. |
| `/api/finance` | List native balances and RWF reporting activity. POST creates or disables accounts and records openings, same-currency transfers, exchanges, expenses and settlements. PUT reverses eligible postings. Foreign `amount`, `received`, `fee`, and `payable_minor` use cents or fen. `rate` is RWF per major unit multiplied by 1,000,000. `settled_on` is an optional Kigali date. |
| `/api/finance/expenses` | Post an operating expense using a stable request key, or list filtered expense history, category totals, recent categories and account balances. |
| `/api/history` | Owner-only page and count for products, stock, purchases, shipments, receipts, sales, contacts, orders, finance, and audit. Supports search, type, dates, sorting and account filters, with a page size capped at 100. |
| `/api/contacts`, `/api/settings` | Manage contact IDs and review unlinked transactions. Manage business, receipt and owner details, category and channel suggestions, payment labels and purchase-rate defaults. |
| `/api/dashboard`, `/api/reports`, `/api/reports/export` | Read the dashboard or a report. Operational reports accept `report`, `q`, and `sort`. Dated reports accept inclusive Kigali `start` and `end` dates in YYYY-MM-DD format. Export accepts `format=pdf` or `format=excel` and uses the same filters. |

## Phase 2 workflows

From Shipments, open **Review damage, shortages and claims** to resolve receiving discrepancies. Review the quantity held and recorded cost before choosing a settlement or loss. The claim workflow separates approval from posting. Cash compensation currently posts to RWF accounts.

In Finance, add an account with its native currency before recording an opening balance. Use **Exchange currencies** when the source and destination currencies differ. For supplier payments made in another currency, also enter the original purchase amount that the payment discharges. The cash conversion and payable reduction are recorded separately.

At checkout, choose an eligible receiving account. Use **Add payment** for a split collection. POS and customer refunds use RWF accounts. The dashboard's available RWF funds excludes foreign balances, which are displayed by currency in Finance and the native account report.

## Phase 3 workflows

Use **Finance → Expenses / Money Out** or **Record expense** on the dashboard. Choose the account, category and amount, and review the date. For a foreign account, also enter the actual exchange rate. Optional notes, payee and references are under **More details**. Use **Attach receipt** while posting or in the details of a saved expense. PDF, JPEG, PNG and WebP files up to 2 MiB are supported. Edit future category suggestions in Settings. The expense history PDF and Excel links include all rows and category totals for the active date, category, account and search filters. Reverse ordinary expenses from history. Exchange fees link back to their exchange in Finance.

Product imports accept the first sheet of an XLSX file or a CSV with `sku`, `name`, `category`, and `selling_price` headings. Every row must pass the server preview and confirmation checks. Opening stock defaults to zero. The optional opening-stock switch accepts `quantity` and `purchase_price` and writes a stock movement for a new SKU only.

Purchase drafts are saved and reopened in the current browser. They do not create a purchase, payable or stock movement. A foreign purchase requires explicit confirmation of its actual rate on posting. Shipment receiving accepts a generated retry reference when the manual reference is blank.
