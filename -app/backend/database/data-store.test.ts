import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './business-schema';
import type { ShipmentEvent } from '../../shared/validation/shipment-input';
import { operationalReport } from '../reports/operational-report';
import { historyInput } from '../../shared/validation/history-input';
import { reportingValue } from '../../shared/finance/settlement-money';
import { expenseInput, expenseFilters } from '../../shared/validation/expense-input';
import { randomUUID } from 'node:crypto';
import { openBusinessDatabase, type BusinessDatabase } from './business-db';
import { PostgresDatabase } from './postgres-db';
import { allocateCost } from '../../shared/finance/costing';
import { DataStore } from './data-store';
import { product as productInput } from '../../shared/validation/business-input';
import { completePasswordReset, requestPasswordReset } from '../auth/password-recovery';
import { ownerSessionStamp, validOwnerSession } from '../auth/owner-session';

let db: BusinessDatabase;
const postgresTestSchema = process.env.BIZFLOW_TEST_POSTGRES_SCHEMA;
let postgresFixture: PostgresDatabase | undefined;
let store: DataStore;
let owner: string;
const product = (quantity = 0) => store.createProduct({
  name: 'Necklace', category: 'Jewelry', purchase_price: 2000, selling_price: 5000,
  quantity, minimum_quantity: 2, supplier: '',
}, owner);

beforeEach(() => {
  if (postgresTestSchema) {
    if (!/^bizflow_test_[a-f0-9]{12}$/.test(postgresTestSchema) || !process.env.BIZFLOW_TEST_POSTGRES_URL) {
      throw new Error('PostgreSQL tests require an imported disposable BizFlow test schema.');
    }
    const fixture = postgresFixture ??= new PostgresDatabase(process.env.BIZFLOW_TEST_POSTGRES_URL, postgresTestSchema);
    const tables = fixture.prepare("SELECT tablename FROM pg_tables WHERE schemaname = ? AND tablename <> 'bizflow_schema_version'")
      .all(postgresTestSchema).map(row => '"' + String(row.tablename).replaceAll('"', '""') + '"');
    fixture.exec('TRUNCATE ' + tables.join(', '));
    fixture.exec(`INSERT INTO accounts (id,name,kind) VALUES
      ('Cash','Cash','Cash'), ('Mobile Money','Mobile Money','Mobile Money'), ('Bank Transfer','Bank','Bank Transfer');
      INSERT INTO business_settings (id,name,address,phone,receipt_footer) VALUES (1,'BizFlow Jewelry','','','')`);
    db = fixture;
  } else {
    db = openBusinessDatabase(':memory:');
  }
  store = new DataStore(() => db);
  owner = store.provisionOwner('Owner', 'owner@example.test', 'temporary-testing-password');
});

test('the product request accepts zero opening stock and a zero reorder threshold', () => {
  expect(productInput.safeParse({
    name: 'Ring', category: 'Jewelry', purchase_price: 0, selling_price: 5000,
    quantity: 0, minimum_quantity: 0, supplier: '',
  }).success).toBe(true);
});

afterEach(() => { if (!postgresFixture) db?.close(); });
afterAll(() => postgresFixture?.close());

test('owner recovery invalidates a prior session without changing the account identity', async () => {
  const before = store.getUserById(owner)!;
  let token = '';
  await requestPasswordReset(store, before.email, before.email, 'https://fixture.example.test', async (_email, link) => {
    token = new URL(link).hash.slice(1);
  });
  expect(await completePasswordReset(store, token, before.email, 'replacement-test-password')).toBe(true);
  expect(await completePasswordReset(store, token, before.email, 'another-test-password')).toBe(false);
  const after = store.getUserById(owner);
  expect(after).toMatchObject({ email: before.email, role: 'admin' });
  expect(validOwnerSession(after, ownerSessionStamp(before))).toBe(false);
});

test('an expense can be posted with only its financial fields, and a receipt can be attached later', () => {
  store.recordFinance({ kind:'opening',account:'Cash',amount:2000,reference:'fund-optional' },owner);
  const input = expenseInput.parse({ request_key:randomUUID(),account:'Cash',amount:1000,category:'Water',settled_on:'2020-07-15' });
  const expense = store.recordExpense(input,owner);
  expect(store.getExpenses(expenseFilters.parse({})).rows[0]).toMatchObject({ status:'Posted',attachments:[] });
  const attachment = { filename:'receipt.pdf',contentType:'application/pdf',contents:Buffer.from('%PDF-1.4\n%%EOF') };
  const receipt = store.attachExpenseReceipt(expense.id,attachment,owner);
  expect(store.attachExpenseReceipt(expense.id,attachment,owner)).toEqual(receipt);
  expect(store.getExpenseReceipt(expense.id,receipt.id)?.filename).toBe('receipt.pdf');
  expect(store.getAccountBalances().find(row => row.id === 'Cash')?.balance).toBe(1000);
  store.reverseFinance(expense.id,'Correction',owner);
  expect(store.getExpenseReceipt(expense.id,receipt.id)).toBeDefined();
  expect(store.getAccountBalances().find(row => row.id === 'Cash')?.balance).toBe(2000);
});

test('a receipt supplied at posting is atomic and retries preserve one debit and one attachment', () => {
  store.recordFinance({ kind:'opening',account:'Cash',amount:2000,reference:'fund-attached' },owner);
  const input = expenseInput.parse({ request_key:randomUUID(),account:'Cash',amount:1000,category:'Water',settled_on:'2020-07-15' });
  const attachment = { filename:'receipt.pdf',contentType:'application/pdf',contents:Buffer.from('%PDF-1.4\n%%EOF') };
  expect(() => store.recordExpense(input,owner,{ ...attachment,contents:Buffer.from('invalid') })).toThrow(/supported receipt/);
  expect(store.getExpenses(expenseFilters.parse({})).totals.count).toBe(0);
  const expense = store.recordExpense(input,owner,attachment);
  expect(store.recordExpense(input,owner,attachment)).toEqual(expense);
  const rows = store.getExpenses(expenseFilters.parse({})).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].attachments).toHaveLength(1);
  expect(db.prepare("SELECT count(*) AS count FROM audit_log WHERE action='expense.receipt_attached'").get()).toEqual({ count:1 });
  expect(store.getAccountBalances().find(row => row.id === 'Cash')?.balance).toBe(1000);
});

test('quick expense posts once to its selected account and preserves history after reversal', () => {
  const mobile = store.createAccount('MTN MoMo','Mobile Money',owner).id;
  store.recordFinance({ kind:'opening', account:mobile, reference:'fund-mobile', amount:20000 },owner);
  store.recordFinance({ kind:'opening', account:'Cash', reference:'fund-cash', amount:40000 },owner);
  const input = expenseInput.parse({ request_key:randomUUID(), account:mobile, amount:15000, category:'Electricity',
    settled_on:'2020-07-15', description:'Shop meter top-up', receipt:'METER-21' });
  const posted = store.recordExpense(input,owner);
  expect(store.recordExpense(input,owner)).toEqual(posted);
  expect(() => store.recordExpense({ ...input, account:'Cash' },owner)).toThrow(/reference/);
  expect(store.getAccountBalances().find(row => row.id === mobile)?.balance).toBe(5000);
  expect(store.getAccountBalances().find(row => row.id === 'Cash')?.balance).toBe(40000);
  const filters = expenseFilters.parse({ start:'2020-07-15',end:'2020-07-15', category:'Electricity', account:mobile,q:'METER-21' });
  expect(store.getExpenses(filters)).toMatchObject({ totals:{ count:1,amount:15000 },rows:[{ actor:'Owner',status:'Posted' }] });
  const report = operationalReport(store,new URLSearchParams({ report:'expenses',start:'2020-07-15',end:'2020-07-15',account:mobile,category:'Electricity',q:'METER-21' }));
  expect(report.totals).toEqual({ amount:15000,groups:[{ category:'Electricity',amount:15000 }] });
  store.reverseFinance(posted.id,'Wrong receipt',owner);
  expect(store.getAccountBalances().find(row => row.id === mobile)?.balance).toBe(20000);
  expect(store.getExpenses(filters).rows[0].status).toBe('Reversed');
  expect(store.getExpenses(expenseFilters.parse({ account:mobile })).totals).toEqual({ count:2,amount:0 });
});

test('invalid and unfunded expenses roll back, and category updates preserve posted names', () => {
  const account = store.createAccount('Disabled','Cash',owner).id;
  const valid = expenseInput.parse({ request_key:randomUUID(),account,amount:1000,category:'Packaging',settled_on:'2020-01-01' });
  store.setAccountActive(account,false,owner);
  expect(() => store.recordExpense(valid,owner)).toThrow(/active account/);
  expect(() => store.recordExpense({ ...valid, account:'Cash' },owner)).toThrow(/Insufficient/);
  expect(() => store.recordExpense({ ...valid, amount:0 },owner)).toThrow();
  expect(store.getExpenses(expenseFilters.parse({})).rows).toEqual([]);
  store.recordFinance({ kind:'opening',account:'Cash',amount:1000,reference:'open' },owner);
  store.recordExpense({ ...valid, account:'Cash' },owner);
  store.saveSettings(store.getSettings(),owner,{ ...store.getPreferences(),expense_categories:['Gift wrap'] });
  expect(store.getPreferences().expense_categories).toEqual(['Gift wrap']);
  expect(store.getExpenses(expenseFilters.parse({})).rows[0].category).toBe('Packaging');
});

test('expense reporting excludes purchases, supplier and shipment settlements, refunds and internal transfers', () => {
  const { purchase } = disputedReceipt();
  const shipment = store.getShipments()[0];
  store.recordFinance({ kind:'opening',account:'Cash',amount:30000,reference:'open' },owner);
  store.recordFinance({ kind:'supplier_payment',account:'Cash',purchase:purchase.id,amount:1000,reference:'supplier' },owner);
  store.recordFinance({ kind:'shipment_payment',account:'Cash',shipment:shipment.id,amount:100,reference:'shipping' },owner);
  store.recordFinance({ kind:'transfer',account:'Cash',destination:'Mobile Money',amount:1000,reference:'transfer' },owner);
  const stock = product(1);
  store.createSale(null,'Cash',[{ product_id:stock.id,quantity:1 }],owner);
  store.returnSaleItem({ item:store.getSales()[0].items[0].id,quantity:1,reference:'return',reason:'Returned',restock:true },owner);
  expect(store.getExpenses(expenseFilters.parse({})).totals).toEqual({ count:0,amount:0 });
});

test('import previews duplicates and opens stock only after confirmed valid rows', () => {
  const clean = { sku:'RING-X',name:'Ring',category:'Gold',selling_price:'1500',quantity:'4',purchase_price:'1000' };
  const invalid = { action:'preview' as const, opening_stock:true, rows:[clean,{ ...clean,sku:'ring-x' }] };
  expect(store.previewProductImport(invalid)[1].error).toMatch(/Duplicate/);
  expect(() => store.confirmProductImport(invalid,owner)).toThrow(/invalid or duplicate/);
  expect(store.getStockMovements()).toHaveLength(0);
  expect(store.confirmProductImport({ ...invalid,rows:[clean] },owner)).toEqual({ count:1 });
  expect(store.getProducts()[0]).toMatchObject({ sku:'RING-X',quantity:4,stock_value:4000 });
  expect(store.getStockMovements()).toHaveLength(1);
  expect(() => store.confirmProductImport({ ...invalid,rows:[clean] },owner)).toThrow(/duplicate/);
  store.confirmProductImport({ ...invalid,opening_stock:false,rows:[{ ...clean,sku:'RING-Y' }] },owner);
  expect(store.getProducts().find(row => row.sku === 'RING-Y')?.quantity).toBe(0);
});

test('purchase retry returns the same order without creating inventory', () => {
  const stock = product();
  const items = [{ product_id:stock.id,quantity:2,unit_cost:1000 }];
  const first = store.createPurchase('Supplier',items,owner,'RWF',1000000,'Reference',undefined,'retry');
  expect(store.createPurchase('Supplier',items,owner,'RWF',1000000,'Reference',undefined,'retry').id).toBe(first.id);
  expect(() => store.createPurchase('Supplier',items,owner,'RWF',1000000,'Different',undefined,'retry')).toThrow(/different order/);
  expect(store.getPurchases()).toHaveLength(1);
  expect(store.getProductById(stock.id)?.quantity).toBe(0);
});

function disputedReceipt(currency: 'RWF' | 'CNY' = 'RWF') {
  const inventory = product();
  const purchase = store.createPurchase('Supplier', [{ product_id: inventory.id, quantity: 10, unit_cost: currency === 'RWF' ? 2000 : 1000 }],
    owner, currency, currency === 'RWF' ? 1000000 : 200000000);
  const item = store.getPurchases()[0].items[0].id;
  const shipment = store.createShipment('Disputed', 'Agent', owner, {
    origin: '', destination: '', expected_date: '', notes: '', expected_expenses: 100,
    lines: [{ item_id: item, quantity: 10 }],
  });
  const receipt = store.recordShipmentEvent({ action: 'record', id: shipment.id, reference: 'receipt-x',
    lines: [{ item_id: item, usable: 6, damaged: 2, missing: 2, explanation: 'Verified incident' }],
    charges: { allocation: 'quantity', expenses: { shipping: 100, customs: 0, clearing: 0, other: 0 } } }, owner);
  return { inventory, purchase, item, event: receipt.id, notes: 'Approved evidence' };
}

test('accepted credits and verified compensation reconcile independently without double settlement', () => {
  const { inventory, purchase, item, event, notes } = disputedReceipt();
  const damage = { item, event, notes, kind: 'damage' as const };
  const shortage = { item, event, notes, kind: 'shortage' as const };
  const claim = store.resolveDiscrepancy({ ...damage, action: 'claim', claimant: 'Supplier', reference: 'claim-one',
    currency: 'RWF', amount: 2000, rate: 1000000 }, owner);
  expect(store.getPurchases()[0].balance).toBe(20000);
  store.resolveDiscrepancy({ action: 'decide', claim: claim.id, accepted: 1800, notes }, owner);
  expect(store.getPurchases()[0].balance).toBe(20000);
  const credit = store.resolveDiscrepancy({ ...damage, action: 'credit', reference: 'credit' }, owner);
  expect(store.getPurchases().find(row => row.id === purchase.id)?.balance).toBe(18200);
  expect(() => store.resolveDiscrepancy({ ...damage, action: 'cash', reference: 'duplicate', account: 'Cash' }, owner)).toThrow(/one settlement/);
  const agent = store.resolveDiscrepancy({ ...shortage, action: 'claim', claimant: 'Agent', reference: 'claim-two',
    currency: 'RWF', amount: 20, rate: 1000000 }, owner);
  store.resolveDiscrepancy({ action: 'decide', claim: agent.id, accepted: 10, notes }, owner);
  store.resolveDiscrepancy({ ...shortage, action: 'cash', reference: 'cash-compensation', account: 'Cash' }, owner);
  expect(store.getAccountBalances().find(row => row.id === 'Cash')?.balance).toBe(10);
  const loss = store.resolveDiscrepancy({ ...damage, action: 'loss', reference: 'loss' }, owner);
  expect(store.getReports().monthly.shipment_losses).toBe(2220);
  expect(store.getProductById(inventory.id)).toMatchObject({ quantity: 6, stock_value: 12060 });
  expect(() => store.resolveDiscrepancy({ action: 'reverse', resolution: credit.id, reference: 'early-reversal', notes }, owner)).toThrow(/dependent loss/);
  store.resolveDiscrepancy({ action: 'reverse', resolution: loss.id, reference: 'reversal-loss', notes }, owner);
  store.resolveDiscrepancy({ action: 'reverse', resolution: credit.id, reference: 'reversal-credit', notes }, owner);
  expect(store.getPurchases()[0].balance).toBe(20000);
  expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'shipment.credit'").get()).toEqual({ n: 1 });
});

test('a recovery moves held damage into inventory once and preserves the original receipt', () => {
  const { inventory, item, event, notes } = disputedReceipt();
  const input = { item, event, notes, kind: 'damage' as const, action: 'recover' as const, reference: 'restore-one', quantity: 1 };
  store.resolveDiscrepancy(input, owner);
  expect(() => store.resolveDiscrepancy(input, owner)).toThrow(/already exists/);
  expect(store.getDiscrepancies().find(row => row.kind === 'damage')).toMatchObject({ damaged: 2, held: 1, remaining: 2010 });
  expect(store.getProductById(inventory.id)).toMatchObject({ quantity: 7, stock_value: 14070 });
});

test('explicit shortage closure includes historical principal and blocks replacement receiving', () => {
  const { inventory, item, event, notes } = disputedReceipt();
  db.prepare("UPDATE shipment_receiving_events SET recorded_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(event);
  db.prepare("UPDATE stock_movements SET movement_date = '2020-01-01T00:00:00.000Z' WHERE purchase_item_id = ?").run(item);
  const result = store.resolveDiscrepancy({ item, event, kind: 'shortage', action: 'loss', notes,
    reference: 'close-missing', close_missing: true }, owner);
  expect(store.getPurchases()[0]).toMatchObject({ balance: 20000, items: [{ closed_quantity: 2 }] });
  expect(() => store.receivePurchaseItem(item, 1, owner)).toThrow(/exceeds/);
  expect(store.getProductById(inventory.id)).toMatchObject({ quantity: 6, stock_value: 12060 });
  expect(store.getReports().monthly.shipment_losses).toBe(4020);
  store.resolveDiscrepancy({ action: 'reverse', resolution: result.id, reference: 'reopen', notes }, owner);
  expect(store.getPurchases()[0].items[0].closed_quantity).toBe(0);
});

test('native CNY and USD accounts settle a foreign payable at historical cost and preserve realized FX', () => {
  const stock = product();
  const purchase = store.createPurchase('Supplier', [{ product_id: stock.id, quantity: 5, unit_cost: 20000 }], owner, 'CNY', 200000000);
  const cny = store.createAccount('CNY Cash', 'Cash', owner, 'CNY').id;
  const usd = store.createAccount('USD Bank', 'Bank Transfer', owner, 'USD').id;
  store.recordFinance({ kind: 'opening', account: cny, amount: 40000, rate: 210000000, reference: 'open-cny' }, owner);
  store.recordFinance({ kind: 'opening', account: usd, amount: 10000, rate: 1300000000, reference: 'open-usd' }, owner);
  const first = { kind: 'supplier_payment' as const, account: cny, amount: 40000, rate: 210000000, reference: 'pay-cny', purchase: purchase.id };
  store.recordFinance(first, owner);
  expect(() => store.recordFinance(first, owner)).toThrow(/reference/);
  expect(store.getPurchases()[0]).toMatchObject({ total_amount: 200000, balance: 120000, rate_micros: 200000000 });
  const second = store.recordFinance({ kind: 'supplier_payment', account: usd, amount: 9000, rate: 1300000000,
    payable_minor: 60000, reference: 'pay-usd', purchase: purchase.id }, owner);
  const finance = store.getFinance();
  expect(finance.transactions.find(row => row.reference === 'manual:pay-cny')).toMatchObject({ amount: 84000, fx_difference: 4000, rate: 210000000 });
  expect(finance.transactions.find(row => row.reference === 'manual:pay-usd')).toMatchObject({ amount: 117000, fx_difference: -3000 });
  expect(finance.accounts.find(row => row.id === usd)).toMatchObject({ balance: 1000, currency: 'USD' });
  expect(store.getPurchases()[0].balance).toBe(0);
  expect(store.getDashboardStats().available_funds).toBe(0);
  store.reverseFinance(second.id, 'Settlement returned', owner);
  expect(store.getPurchases()[0].balance).toBe(120000);
  expect(store.getReports().monthly.fx_difference).toBe(4000);
  expect(reportingValue(1, 'USD', 150000000)).toBe(2);
});

test('explicit native supplier credit and final payment discharge the same obligation only once', () => {
  const { purchase, item, event, notes } = disputedReceipt('CNY');
  const incident = { item, event, notes, kind: 'damage' as const };
  const claim = store.resolveDiscrepancy({ ...incident, action: 'claim', claimant: 'Supplier',
    reference: 'native-claim', currency: 'CNY', amount: 1000, rate: 220000000 }, owner);
  store.resolveDiscrepancy({ action: 'decide', claim: claim.id, accepted: 2200, notes }, owner);
  store.resolveDiscrepancy({ ...incident, action: 'credit', reference: 'native-credit', payable_minor: 1000 }, owner);
  const cash = store.createAccount('CNY Cash', 'Cash', owner, 'CNY').id;
  store.recordFinance({ kind: 'opening', account: cash, amount: 10000, rate: 220000000, reference: 'opening' }, owner);
  const payment = { kind: 'supplier_payment' as const, account: cash, rate: 220000000, reference: 'settlement', purchase: purchase.id, settled_on: '2020-07-20' };
  expect(() => store.recordFinance({ ...payment, amount: 10000 }, owner)).toThrow(/remaining purchase obligation/);
  store.recordFinance({ ...payment, amount: 9000 }, owner);
  expect(store.getPurchases()[0].balance).toBe(0);
  expect(store.getFinance().transactions.find(row => row.reference === 'manual:settlement')).toMatchObject({
    payable_amount: 18000, amount: 19800, fx_difference: 1800, recorded_at: '2020-07-19T22:00:00.000Z',
  });
});

test('cross-currency exchange posts both actual legs and the fee, and reverses atomically', () => {
  const usd = store.createAccount('USD Bank', 'Bank Transfer', owner, 'USD').id;
  store.recordFinance({ kind: 'opening', amount: 200000, account: 'Cash', reference: 'open' }, owner);
  expect(() => store.recordFinance({ kind: 'transfer', amount: 130000, account: 'Cash', destination: usd, reference: 'wrong' }, owner)).toThrow(/different currencies/);
  const exchange = store.recordFinance({ kind: 'exchange', amount: 130000, account: 'Cash', destination: usd, received: 10000, fee: 500, reference: 'exchange' }, owner);
  const balance = (id: string) => store.getAccountBalances().find(row => row.id === id)?.balance;
  expect([balance('Cash'), balance(usd)]).toEqual([69500, 10000]);
  expect(store.getDashboardStats()).toMatchObject({ total_revenue: 0, total_expenses: 500 });
  store.reverseFinance(exchange.id, 'Exchange canceled', owner);
  expect([balance('Cash'), balance(usd)]).toEqual([200000, 0]);
  expect(store.getDashboardStats().total_expenses).toBe(0);
});

test('mixed checkout uses eligible accounts, protects its retry key and applies a selected refund', () => {
  const stock = product(2);
  const mobile = store.createAccount('Business MoMo', 'Mobile Money', owner).id;
  const bank = store.createAccount('Business bank', 'Bank Transfer', owner).id;
  const items = [{ product_id: stock.id, quantity: 2 }];
  const payments = [{ method: 'Mobile Money' as const, amount: 4000, account: mobile, reference_number: 'momo-payment' },
    { method: 'Cash' as const, amount: 2000, account: 'Cash' }, { method: 'Bank Transfer' as const, amount: 1000, account: bank }];
  const checkout = () => store.createSale('Customer', 'Mobile Money', items, owner, undefined, undefined, 'retry-a', undefined, payments);
  store.setAccountActive(bank, false, owner);
  expect(checkout).toThrow(/active account/);
  expect(store.getSales()).toHaveLength(0);
  expect(store.getProductById(stock.id)?.quantity).toBe(2);
  store.setAccountActive(bank, true, owner);
  const sale = checkout();
  expect(checkout().id).toBe(sale.id);
  expect(() => store.createSale('Other', 'Mobile Money', items, owner, undefined, undefined, 'retry-a', undefined, payments)).toThrow(/different sale/);
  expect(store.getSales()[0].balance).toBe(3000);
  expect(store.getAccountBalances().find(row => row.id === mobile)?.balance).toBe(4000);
  const line = store.getSales()[0].items[0];
  expect(store.returnSaleItem({ item: line.id, quantity: 1, account: mobile, reason: 'approved', restock: true, reference: 'return' }, owner).refund).toBe(2000);
  expect(store.getAccountBalances().find(row => row.id === mobile)?.balance).toBe(2000);
});

test('history filters in Kigali before stable SQL pagination and clamps empty pages', () => {
  const first = product();
  const second = product();
  const third = product();
  const update = db.prepare('UPDATE products SET name = ?, category = ?, created_at = ? WHERE id = ?');
  update.run('Ring A', 'Gold', '2026-08-01T22:30:00Z', first.id);
  update.run('Ring B', 'Gold', '2026-08-01T22:30:00Z', second.id);
  update.run('Ring C', 'Silver', '2026-08-01T22:30:00Z', third.id);
  const query = { ...historyInput.parse({ resource: 'products', q: 'rING', status: 'gold', size: 1, page: 1, sort: 'name' }), start: '2026-08-02', end: '2026-08-02' };
  expect(store.getHistory(query)).toMatchObject({ total: 2, pages: 2, rows: [{ id: first.id }] });
  expect(store.getHistory({ ...query, page: 9 })).toMatchObject({ page: 2, rows: [{ id: second.id }] });
  expect(store.getHistory({ ...query, end: '2026-08-01' })).toMatchObject({ total: 0, page: 1, rows: [] });
  expect(() => historyInput.parse({ resource: 'products', size: 101 })).toThrow();
});

test('exchange rate defaults can change without rewriting a captured purchase rate', () => {
  const stock = product();
  const settings = store.getSettings();
  const preferences = { ...store.getPreferences(), cny_rate_micros: 200000000 };
  store.saveSettings(settings, owner, preferences);
  store.createPurchase('Supplier', [{ product_id: stock.id, quantity: 3, unit_cost: 200 }], owner,
    'CNY', store.getPreferences().cny_rate_micros!);
  store.saveSettings(settings, owner, { ...preferences, cny_rate_micros: 210000000 });
  expect(store.getPurchases()[0]).toMatchObject({ total_amount: 1200, rate_micros: 200000000 });
});

test('operational reports share Kigali date filters and keep transfers out of profitability', () => {
  const stock = product(2);
  const sale = store.createSale(null, 'Cash', [{ product_id: stock.id, quantity: 1 }], owner);
  db.prepare('UPDATE sales SET sale_date = ? WHERE id = ?').run('2026-08-01T22:30:00.000Z', sale.id);
  const account = store.createAccount('Savings', 'Bank Transfer', owner);
  store.recordFinance({ kind: 'transfer', account: 'Cash', destination: account.id, amount: 700, reference: 'move' }, owner);
  const report = (name: string, filter = '') => operationalReport(store, new URLSearchParams(
    `report=${name}&start=2026-08-02&end=2026-08-02${filter}`));
  expect(report('profitability').rows).toContainEqual(['Gross profit', 3000]);
  expect(report('profitability').rows).toContainEqual(['Operating expenses', 0]);
  expect(report('products', '&q=necklace').rows).toEqual([['Necklace', 1, 5000]]);
  expect(report('products', '&q=other').rows).toEqual([]);
  expect(report('accounts').rows).toContainEqual(['Savings', 'Bank Transfer', 700]);
  expect(() => report('constructor')).toThrow(/available report/);
});

test('explicit product families group distinct SKUs without changing their inventory or history', () => {
  const base = product(3);
  const other = store.createProduct({ ...base, sku: 'RING-7', family: 'Gold ring', variant_size: '7', quantity: 5 }, owner);
  const first = store.updateProduct(base.id, { family: 'Gold ring', variant_size: '6' }, owner);
  expect(first).toMatchObject({ id: base.id, quantity: 3, variant_size: '6' });
  expect(other).toMatchObject({ family: 'Gold ring', quantity: 5, variant_size: '7' });
  expect(store.getStockMovements().some(row => row.product_id === base.id)).toBe(true);
  expect(product().family).toBeNull();
});

test('same-name contacts remain separate and renaming preserves links and transaction snapshots', () => {
  const contact = { kind: 'Customer', name: 'Same Name', phone: '', email: '', location: '', create: true };
  const first = store.saveContact(contact, owner);
  const second = store.saveContact(contact, owner);
  const stock = product(3);
  const sale = store.createSale(null, 'Credit', [{ product_id: stock.id, quantity: 1 }], owner, undefined, undefined, undefined, first.id);
  expect(store.getContacts().find(row => row.id === second.id)?.sales).toEqual([]);
  store.saveContact({ ...contact, id: first.id, name: 'Updated Name' }, owner);
  expect(store.getContacts().find(row => row.id === first.id)).toMatchObject({
    name: 'Updated Name', sales: [{ id: sale.id, customer_name: 'Same Name' }],
  });
  const legacy = store.createSale('Same Name', 'Credit', [{ product_id: stock.id, quantity: 1 }], owner);
  expect(store.getUnlinkedContacts()).toContainEqual(expect.objectContaining({ id: legacy.id }));
  store.linkContact(legacy.id, 'sale', second.id, owner);
  expect(store.getContacts().find(row => row.id === second.id)?.sales[0].id).toBe(legacy.id);
  expect(() => store.linkContact(legacy.id, 'sale', first.id, owner)).toThrow(/cannot/);
});

test('a manifest reserves multiple purchase orders and preserves exact charge allocation across three receipts', () => {
  const stock = product();
  for (const supplier of ['First', 'Second']) {
    store.createPurchase(supplier, [{ product_id: stock.id, quantity: 50, unit_cost: 2000 }], owner);
  }
  const [a, b] = store.getPurchases().map(order => order.items[0].id);
  const shipment = store.createShipment('Manifest', 'Agent', owner, {
    origin: 'China', destination: 'Kigali', expected_date: '', notes: '', expected_expenses: 901,
    lines: [a, b].map(item_id => ({ item_id, quantity: 50 })),
  });
  expect(store.getProductById(stock.id)?.quantity).toBe(0);
  expect(() => store.receivePurchaseItem(a, 1, owner)).toThrow(/reservation/);
  const line = (item_id: string, usable: number) => ({ item_id, usable, damaged: 0, missing: 0, explanation: '' });
  const first: ShipmentEvent = { action: 'record', id: shipment.id, reference: '40',
    lines: [line(a, 40)], charges: { allocation: 'quantity', expenses: { shipping: 901, customs: 0, clearing: 0, other: 0 } } };
  expect(store.recordShipmentEvent(first, owner)).toEqual(store.recordShipmentEvent(first, owner));
  expect(() => store.recordShipmentEvent({ ...first, lines: [line(a, 39)] }, owner)).toThrow(/different/);
  store.recordShipmentEvent({ action: 'record', id: shipment.id, reference: '35', lines: [line(a, 10), line(b, 25)] }, owner);
  expect(store.getShipments()[0].status).toBe('In transit');
  store.recordShipmentEvent({ action: 'record', id: shipment.id, reference: '25', lines: [line(b, 25)] }, owner);
  expect(store.getProductById(stock.id)).toMatchObject({ quantity: 100, stock_value: 200901 });
  expect(store.getShipments()[0]).toMatchObject({ status: 'Received', expenses: 901, landed_cost: 200901 });
  expect(store.getShipments()[0].events).toHaveLength(3);
});

test('damage consumes purchase quantity, confirmed shortage releases it, and only usable goods enter stock', () => {
  const stock = product();
  store.createPurchase('Supplier', [{ product_id: stock.id, quantity: 10, unit_cost: 2000 }], owner);
  const item = store.getPurchases()[0].items[0];
  const shipment = store.createShipment('Manifest', 'Agent', owner, {
    origin: '', destination: '', expected_date: '', notes: '', expected_expenses: 100,
    lines: [{ item_id: item.id, quantity: 10 }],
  });
  const event: ShipmentEvent = { action: 'record', id: shipment.id, reference: 'incident',
    lines: [{ item_id: item.id, usable: 6, damaged: 2, missing: 2, explanation: 'Damaged carton and two missing units' }],
    charges: { allocation: 'value', expenses: { shipping: 100, customs: 0, clearing: 0, other: 0 } } };
  expect(() => store.recordShipmentEvent({ ...event, lines: [{ ...event.lines[0], usable: 7 }] }, owner)).toThrow(/outstanding/);
  expect(store.getShipments()[0].expenses).toBe(0);
  store.recordShipmentEvent(event, owner);
  expect(store.getShipments()[0].events[0].lines[0]).toMatchObject({
    damaged_supplier_cost: 4000, allocated_expense: 100, capitalized_expense: 60,
  });
  expect(store.getProductById(stock.id)).toMatchObject({ quantity: 6, stock_value: 12060 });
  expect(store.getDashboardStats().supplier_balance).toBe(20000);
  store.receivePurchaseItem(item.id, 2, owner);
  expect(() => store.receivePurchaseItem(item.id, 1, owner)).toThrow(/exceeds/);
});

test.skipIf(!!postgresTestSchema)('a version 12 database upgrades without changing its legacy shipment receipt or stock link', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bizflow-manifest-'));
  const file = join(directory, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    try {
      for (const migration of migrations.slice(0, 12)) legacy.exec(migration.sql);
      legacy.exec(`
        PRAGMA user_version = 12;
        INSERT INTO users VALUES ('owner', 'Owner', 'owner@example.test', 'hash', 'admin', '2026-01-01');
        INSERT INTO contacts VALUES ('c', 'Supplier', 'Supplier', '123', '', 'Kigali');
        INSERT INTO products (id, sku, name, category, purchase_price, selling_price, quantity, minimum_quantity, supplier, created_at, stock_value)
          VALUES ('p', 'SKU', 'Ring', 'Ring', 20, 100, 1, 0, 'Supplier', '2026-01-01', 20);
        INSERT INTO purchases VALUES ('o', 'Supplier', 10, '2026-01-01', '2026-01-01', 'owner', 'RWF', 1000000, '');
        INSERT INTO purchase_items VALUES ('i', 'o', 'p', 1, 10, 10, 10);
        INSERT INTO shipments VALUES ('s', 'Legacy', 'Agent', 'Received', '2026-01-01', 'owner');
        INSERT INTO stock_movements (id, product_id, product_name, type, quantity, movement_date, remaining_stock, reason, actor_id, purchase_item_id)
          VALUES ('m', 'p', 'Ring', 'Stock In', 1, '2026-01-01', 1, 'Legacy receipt', 'owner', 'i');
        INSERT INTO shipment_expenses VALUES ('s', 'shipping', 10);
        INSERT INTO shipment_receipt_items VALUES ('s', 'i', 'm', 10, 10);
        INSERT INTO money_transactions (id,kind,to_account,amount,reference,actor_id,recorded_at)
          VALUES ('funds','opening','Cash',1234,'legacy-funds','owner','2026-01-01');
      `);
    } finally { legacy.close(); }
    expect(() => openBusinessDatabase(file)).toThrow(/reviewed schema upgrade/);
    const upgraded = openBusinessDatabase(file, true);
    try {
      const records = new DataStore(() => upgraded);
      expect(records.getShipments()[0]).toMatchObject({ id: 's', expenses: 10, landed_cost: 20 });
      expect(records.getPurchases()[0].items[0]).toMatchObject({ received_quantity: 1, reserved_quantity: 0 });
      expect(records.getContactDirectory()).toContainEqual(expect.objectContaining({ id: 'c', phone: '123' }));
      expect(records.getAccountBalances()).toContainEqual(expect.objectContaining({ id: 'Cash', currency: 'RWF', balance: 1234 }));
      expect(records.getContacts()[0].purchases).toEqual([]);
      expect(records.getUnlinkedContacts()).toContainEqual(expect.objectContaining({ id: 'o', kind: 'purchase' }));
      expect(upgraded.prepare('SELECT movement_id FROM shipment_receipt_items').get()).toMatchObject({ movement_id: 'm' });
      expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { upgraded.close(); }
  } finally {
    rmSync(directory, { recursive: true, maxRetries: 5 });
  }
});

test('receipt captures landed cost and only increases confirmed stock', () => {
  const item = product();
  store.createPurchase('Supplier', [{ product_id: item.id, quantity: 110, unit_cost: 2000 }], owner);
  expect(store.getProductById(item.id)?.quantity).toBe(0);
  const line = store.getPurchases()[0].items[0];
  const shipment = store.createShipment('Shipment 1', 'Agent', owner);
  store.receiveShipment(shipment.id, [{ item_id: line.id, quantity: 100 }], { shipping: 50000, customs: 30000, other: 10000 }, 'quantity', owner);
  expect(store.getProductById(item.id)).toMatchObject({ quantity: 100, purchase_price: 2900, stock_value: 290000 });
  expect(() => store.receivePurchaseItem(line.id, 11, owner)).toThrow(/exceeds/);
  store.createSale(null, 'Cash', [{ product_id: item.id, quantity: 1 }], owner);
  expect(store.getDashboardStats().total_profit).toBe(2100);
});

test('duplicate cart lines cannot oversell or leave a payment or movement behind', () => {
  const item = product(5);
  const lines = [{ product_id: item.id, quantity: 3 }, { product_id: item.id, quantity: 3 }];
  expect(() => store.createSale(null, 'Cash', lines, owner)).toThrow(/available/);
  expect(store.getProductById(item.id)?.quantity).toBe(5);
  expect(store.getSales()).toHaveLength(0);
  expect(store.getPayments()).toHaveLength(0);
  expect(store.getStockMovements()).toHaveLength(1);
});

test('partial collections and transfers remain separate from sales and expenses', () => {
  const item = product(1);
  const sale = store.createSale('Customer', 'Cash', [{ product_id: item.id, quantity: 1 }], owner, 1000);
  const p = { sale_id: sale.id, amount: 2000, status: 'Paid' as const, method: 'Cash' as const, reference_number: 'deposit' };
  store.createPayment(p, owner);
  expect(() => store.createPayment(p, owner)).toThrow(/exists/);
  expect(() => store.createPayment({ ...p, amount: 2001, reference_number: 'excess' }, owner)).toThrow(/balance/);
  store.recordFinance({ kind: 'transfer', amount: 500, reference: 'transfer', account: 'Cash', destination: 'Mobile Money' }, owner);
  expect(store.getDashboardStats()).toMatchObject({ total_revenue: 5000, total_expenses: 0, customer_balance: 2000, available_funds: 3000 });
});

test('an online order changes inventory only once on confirmation', () => {
  const item = product(2);
  const order = store.createOnlineOrder('Customer', 'Phone', 'WhatsApp', [{ product_id: item.id, quantity: 1 }], owner);
  expect(store.getSales()).toHaveLength(0);
  store.changeOnlineOrder(order.id, 'confirm', owner, 'Credit');
  expect(() => store.changeOnlineOrder(order.id, 'confirm', owner, 'Credit')).toThrow(/cannot/);
  expect(store.getProductById(item.id)?.quantity).toBe(1);
  expect(store.getSales()).toHaveLength(1);
});

test('rounding preserves the full expense and an exchange rate is captured', () => {
  expect(allocateCost(100, [1, 1, 1])).toEqual([33, 34, 33]);
  const item = product();
  store.createPurchase('Supplier', [{ product_id: item.id, quantity: 3, unit_cost: 125 }], owner, 'CNY', 199500000);
  expect(store.getPurchases()[0]).toMatchObject({ currency: 'CNY', rate_micros: 199500000, total_amount: 748 });
});

test('returns credit outstanding debt and refund excess payment once', () => {
  const stock = product(2);
  store.createSale('Customer', 'Cash', [{ product_id: stock.id, quantity: 2 }], owner, 7500);
  const item = store.getSales()[0].items[0];
  const input = { item: item.id, quantity: 1, reason: 'Customer return', restock: true, account: 'Cash', reference: 'return-1' };
  expect(store.returnSaleItem(input, owner).refund).toBe(2500);
  expect(() => store.returnSaleItem(input, owner)).toThrow(/reference/);
  expect(store.getDashboardStats()).toMatchObject({ total_revenue: 5000, total_profit: 3000, customer_balance: 0, available_funds: 5000 });
  expect(store.getProductById(stock.id)).toMatchObject({ quantity: 1, stock_value: 2000 });
});

test.skipIf(!!postgresTestSchema)('schema and records survive a database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bizflow-'));
  const file = join(directory, 'business.sqlite');
  try {
    const first = openBusinessDatabase(file);
    try {
      const initial = new DataStore(() => first);
      const actor = initial.provisionOwner('Owner', 'owner@example.test', 'temporary-testing-password');
      initial.recordFinance({ kind:'opening',account:'Cash',amount:2000,reference:'opening-persist' },actor);
      initial.recordExpense(expenseInput.parse({ request_key:randomUUID(),account:'Cash',amount:750,category:'Water',settled_on:'2020-07-10' }),actor);
    } finally {
      first.close();
    }
    const reopened = openBusinessDatabase(file);
    try {
      const persisted = new DataStore(() => reopened);
      expect(persisted.getUserByEmail('OWNER@example.test')?.name).toBe('Owner');
      expect(persisted.getAccountBalances().find(account => account.id === 'Cash')?.balance).toBe(1250);
      expect(persisted.getExpenses(expenseFilters.parse({ category:'Water' })).totals).toEqual({ count:1,amount:750 });
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, maxRetries: 5 });
  }
});

test('reversing a customer payment keeps its history and reopens the balance', () => {
  const stock = product(1);
  store.createSale('Customer', 'Cash', [{ product_id: stock.id, quantity: 1 }], owner, 1000);
  const event = store.getFinance().transactions[0];
  store.reverseFinance(event.id, 'Duplicate posting', owner);
  expect(() => store.reverseFinance(event.id, 'Duplicate reversal', owner)).toThrow(/unreversed/);
  expect(store.getFinance().transactions).toHaveLength(2);
  expect(store.getPayments()[0].reversed).toBe(1);
  expect(store.getDashboardStats()).toMatchObject({ total_revenue: 5000, available_funds: 0, customer_balance: 5000 });
});
