# Spring reporting

Authenticate as the owner. Use `GET /api/v1/reports/{kind}` with `from`, `to`, `q`, `page` and `size`. Date boundaries are inclusive in Kigali. The sales report accepts `group=day|week|month|product|category|channel`. Totals are computed before pagination. `accounts` and `inventory` show current snapshots and reject date filters.

| Report | Measures |
| --- | --- |
| `sales` | Revenue net of credits, captured COGS net of usable returns, and gross profit. |
| `receivables`, `payables` | Open receivables, paid amounts, refunds, captured purchase values, credits, settlements and realized exchange differences. |
| `expenses` | Operating expense detail with category and date, excluding reversed entries. Category totals with filters are available through `/api/v1/expenses/category-totals`. |
| `accounts`, `transactions`, `settlements` | Current native balances, classified posting history, actual collections/refunds, supplier and shipment cash, fees and realized exchange differences. Native amounts have no cross-currency sum. |
| `inventory`, `movements` | Quantity and RWF stock value, plus movement deltas and audit references. |
| `purchases`, `receipts`, `discrepancies` | Purchase and exchange-rate history, active receiving quantities, landed costs, damage/shortage and approved losses. |

`GET /api/v1/reports/{kind}/export?format=pdf|xlsx` uses the same filters and includes all matching rows up to 10,000. `GET /api/v1/reports/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` provides the daily series with no synthesized date buckets. Operational snapshot reports reflect the current state of open items, even when filtered by an original transaction date.

Download an itemized sales receipt using `GET /api/v1/reports/sale-receipt/{id}/export?format=pdf|xlsx`. The receipt includes credits, refunds, net paid and the balance due.
