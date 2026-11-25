# Software requirements

BizFlow Jewelry supports an owner who buys jewelry locally or from China, receives it in Rwanda and sells it through a shop or online. The owner should be able to explain stock quantities, settlement balances, available funds and the cost and margin of each sale. Future staff and branch access will require explicit permissions and ownership of records.

| Workflow | Requirement and acceptance criterion |
| --- | --- |
| Access and settings | Provision one owner securely. Require authentication for every business API. Maintain business identity, receipt settings, exchange rates, categories, payment methods and channels. Authorized actions identify the actor in the audit log. |
| Products | Maintain SKU, product name, category, description, photo, variant if applicable, price and reorder threshold. SKU must be unique. Archived products retain transaction history. |
| Stock | Record opening balances, sales, receipts, returns, damage, missing stock and documented count corrections. A concurrent sale and correction cannot create a negative stock balance. |
| Purchasing | Capture local and international suppliers and agents, contact details, purchase items, currency, captured exchange rate and invoice reference. A purchase changes the supplier payable and leaves physical stock pending until receipt. |
| Imports | Track shipments and costs. A shipment can carry lines from several orders and an order can arrive across shipments. Confirm usable quantities, document damaged or missing stock, and retain outstanding quantities. A receipt cannot exceed the order. |
| Shipment reconciliation | Plan manifests before stock arrives and reserve ordered quantities. Post multiple independently referenced events. Record damaged and confirmed missing units with reasons. Each event updates only usable stock and retains its historical cost. |
| Costing | Allocate confirmed shipment costs by quantity or value. Weight may be offered where captured. The sum allocated must equal entered charges. Receiving 100 units at RWF 200,000 with RWF 90,000 in charges must value them at RWF 290,000. |
| POS | Find products, enter quantities and authorized discounts, select channel and payment, issue a receipt and process returns. A failed sale changes neither stock, revenue nor cash. A partial sale payment leaves a receivable. |
| Online orders | Capture customer, contact, source, products and fulfillment. Confirmation produces one linked sale. Before confirmation the order creates no revenue or stock movement. |
| Customer and supplier balances | Keep contact and purchase history. Partial settlements reduce the corresponding balance. Duplicate payment references and overpayments are rejected. |
| Contact identity | Use a selected ID for new linked transactions. Renaming a contact preserves its linked history and each transaction's original name. A legacy transaction requires manual review before linking. |
| Finances | Track opening balances, payments, import cash outflows, operating expenses and transfers. A transfer affects two account balances and leaves revenue and expenses unchanged. Corrections preserve the original financial event. |
| Reporting | Show Kigali daily, weekly and monthly activity and allow custom date ranges. Report channel and product sales, cost of goods, gross profit, operating expenses, stock valuation, purchase and shipment costs, stock movements and balances. Provide downloadable PDF and Excel summaries. |
| Operational reports | Clearly distinguish current snapshots from dated events. On-screen rows, PDF and Excel share report selection, date range, search and sort. Pagination affects the screen only. |
| Shipment finance | Explicitly decide claims and post at most one active credit or cash settlement per claim. Hold damaged units until disposition. Approve losses separately from gross profit and include missing principal only when closing the unreserved purchase quantity. |
| Native-currency finance | Keep RWF, USD and CNY accounts in native units. Capture conversion snapshots and realized FX separately from gross profit. Cross-currency exchanges post both legs atomically and record fees separately. |
| Mixed checkout | Collect several RWF payments in one sale through eligible active accounts. Collected payments reduce receivables. Retry must preserve the same posting and inventory result. |
| Operational history | Filter records before SQL pagination, keep stable sort and total counts, and enforce owner access. Report downloads include all records matching the displayed filters. |
| Smart data entry | Suggest saved contacts and products, permit inline contact creation, preview product import before posting, and keep purchase drafts free of stock and ledger effects. |
| Quick expenses | Post to the selected eligible account once, preserve date and historical category, retain reversal history, and export individual postings and grouped totals using matching filters. Amount, category, account and date are the required entry fields. Foreign accounts also require the actual conversion rate. Receipt numbers and attachments are optional. The owner can attach a receipt during entry or from saved expense details. |

The interface must support desktop and mobile browsers, keyboard navigation, accessible controls, clear validation, empty and loading states, and explicit confirmation for destructive operations. Monetary values use integer units with deterministic rounding. Transaction writes must be durable and atomic. Historical prices, exchange rates, payments and stock movements must remain traceable. Staff administration, payroll, loyalty, marketing and public commerce are outside scope.

See the [implementation plan](IMPLEMENTATION_PLAN.md) for current coverage.

For Spring checkout, a walk-in can pay in full without a customer record. An unpaid balance requires a stable customer ID. Checkout and return retries reuse the saved transaction. A return settles the receivable before issuing a refund from a funded RWF account. [Spring sales and posting rules](SPRING_SALES.md)
