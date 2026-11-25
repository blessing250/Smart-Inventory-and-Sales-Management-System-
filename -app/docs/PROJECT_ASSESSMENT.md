# Existing project assessment

## Restructuring review

The App Router now runs against the versioned SQLite store. Owner authorization, stock transactions, expense postings, returns and initial reports were already in production code when this review began. The chief shipment limitation was one receipt per shipment and purchase line, coupled with closing the shipment on receipt. Contact history matched names. Product grouping and operational exports were absent.

The review covered dashboard pages and styling, route handlers and authorization, data access, SQL migrations, validation, calculations, tests, configuration, dependencies and the linked project documents. The project later removed the disconnected Prisma prototype, its starter calculations and the unreferenced Next.js starter graphics.

## Historical prototype assessment

The application uses Next.js App Router, React, TypeScript, Tailwind, NextAuth credentials, Zod and Vitest. Route handlers call a process-local data store. The Prisma model is for SQLite and is disconnected from those handlers. The repository contains no database migrations or checked-in database.

| Decision | Findings |
| --- | --- |
| Retain | Existing navigation, product and transaction forms, RWF formatting, password hashing, report export libraries, and existing REST entry points. |
| Improve | Require owner access on all business routes, make writes durable and atomic, validate transaction totals and related records, and derive reports from dated sales and actual cost. |
| Remove | Demo credentials and grocery fixtures from normal business use, employee administration from the owner workflow, and duplicate fixture data once its remaining UI dependencies are replaced. |
| Add | Suppliers, customers, purchase and receipt separation, shipment allocations, landed cost, POS payments and returns, online orders, accounts, expenses, audit history, and owner settings. |
| Database | Keep the existing SQLite deployment model initially. Add versioned schema changes and retain existing identifiers and transactional history. Separate stock events, payment allocations, and account activity. |

Purchase creation currently receives stock immediately. A sale with duplicate product lines can oversell because the checks run before any stock is deducted. Payments can reference missing sales and exceed receivables. Direct stock edits and product deletion can break the movement history. Dashboard and reports use all-time totals, and their profit measure subtracts purchases from revenue.

The source tree cannot establish whether a private SQLite database or live server contains business records. A live server's in-memory records need to be extracted before restarting it. Legacy stock balances, incomplete sale lines, payment statuses and original costs require reconciliation before importing them as historical fact. Preserve existing databases and data files during the transition.

The configured legacy SQLite filename was absent under both the application directory and the Prisma schema directory when checked. The new runtime opens a separate file and rejects an unversioned database that already contains tables. No legacy database was modified or imported.
