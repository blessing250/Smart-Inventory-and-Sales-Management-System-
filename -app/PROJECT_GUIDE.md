# Smart Inventory and Sales Management System - Project Guide

## What Was Fixed

The empty space above the dashboard pages was in `app/dashboard/layout.tsx`.

The sidebar had this class:

```tsx
lg:static
```

That made the sidebar take normal page space on desktop. Because the sidebar is `h-screen`, the page content was pushed below a full screen of empty space. The fix was to keep the sidebar fixed on desktop and let the main content start beside it with:

```tsx
<main className="min-h-screen pt-20 lg:ml-64 lg:pt-0">
```

## What The Project Already Has

- Next.js app router structure
- Login with admin and employee demo accounts
- Sidebar dashboard layout
- Product management UI
- Stock in and stock out UI
- Sales management UI
- Purchase management UI
- Payment tracking UI
- Reports UI
- User roles UI
- API routes for products, stock, sales, purchases, payments, dashboard, reports, and users
- In-memory data store for demo/testing
- RWF currency formatting that always displays `RWF`, not browser-locale `RF`
- Prisma SQLite schema in `prisma/schema.prisma`
- Secure password hashing with `bcryptjs`
- Admin user create/edit/delete UI
- Admin-only API checks for users, purchases, reports, and product write actions
- PDF and Excel report export endpoints
- Starter tests for profit, stock, and sale subtotal calculations

## What Is Still Missing

1. Finish Database Integration
   - Prisma and SQLite are configured, and the schema is written.
   - The app still uses `app/lib/data-store.ts` at runtime.
   - Next step: replace each data-store method with Prisma queries.
   - `pnpm prisma:push` currently reaches Prisma's schema engine but fails with a blank schema-engine error on this machine. If it continues, try an LTS Node version such as Node 22.

2. More API Role Protection
   - Admin checks exist for the most sensitive routes.
   - Next step: decide whether stock changes and payment updates should be admin-only or employee-allowed.

3. Form Validation Messages
   - APIs validate data, but each page can show more specific field errors.
   - Example: show "Selling price is required" near the selling price input.

4. Persistent Stock History In Runtime
   - The Prisma schema includes `StockMovement`.
   - Stock movements are tracked in memory.
   - Once data-store is replaced with Prisma, movements will persist permanently.

5. More Tests
   - Calculation tests exist.
   - Next step: add API route tests for products, sales, purchases, users, and reports.

6. Deployment Setup
    - Add environment variables for production auth secret and database URL.
    - Deploy on Vercel, Render, or another hosting platform.

## Suggested Development Roadmap

### Step 1: Stabilize Current App

Run these commands after each change:

```bash
pnpm lint
pnpm build
pnpm test
```

Open the app:

```bash
pnpm dev
```

Use:

```text
Admin: admin@inventory.com / admin123
Employee: employee@inventory.com / employee123
```

### Step 2: Add A Database

Prisma is installed with pnpm. Useful commands:

```bash
pnpm prisma:generate
pnpm prisma:push
```

Create models for:

- User
- Product
- Purchase
- PurchaseItem
- Sale
- SaleItem
- Payment
- StockMovement

The schema already exists in `prisma/schema.prisma`. Replace `app/lib/data-store.ts` with Prisma queries when the local Prisma engine issue is resolved.

### Step 3: Make Authentication Production Ready

- Password hashing with `bcryptjs` is already added.
- User creation/editing/deleting is already admin-only.
- Store `NEXTAUTH_SECRET` in `.env.local`.

### Step 4: Improve Each Page

Work page by page:

1. Products: connect to database, add validation, improve delete confirmation.
2. Stock: save all movements, prevent invalid stock out.
3. Sales: support multiple sale items cleanly and print receipts.
4. Purchases: support multiple products per purchase.
5. Payments: allow updating pending credit payments to paid.
6. Reports: add real date filters and export files.
7. Users: add create/edit/delete user forms.

### Step 5: Polish For Portfolio

- Add screenshots to README.
- Add a clear feature list.
- Add database schema image or ERD.
- Add deployment link.
- Add a short demo video.

## Important Files

- `app/dashboard/layout.tsx` - sidebar and page layout
- `app/lib/data-store.ts` - temporary in-memory backend
- `app/types/inventory.ts` - TypeScript data types
- `app/api/*` - API endpoints
- `app/dashboard/*` - UI pages

## Best Next Improvement

The most important next task is replacing the in-memory store with a real database. That will make your project feel like a real full-stack business system instead of a demo.
