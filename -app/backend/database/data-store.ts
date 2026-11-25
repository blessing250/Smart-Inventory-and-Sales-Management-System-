import { createHash, randomUUID as id } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import type { Payment, Product, Purchase, PurchaseItem, Sale, SaleItem, StockMovement, User } from '../../shared/types/inventory';
import { connectBusinessDatabase, transaction, type BusinessDatabase } from './business-db';
import { allocateCost, roundedShare } from '../../shared/finance/costing';
import type { ShipmentEvent, ShipmentManifest } from '../../shared/validation/shipment-input';
import type { Preferences } from '../../shared/types/preferences';
import { businessDate as date, businessPeriod } from '../../shared/business-date';
import { reportingValue, type Currency } from '../../shared/finance/settlement-money';
import { historySql } from './history-queries';
import type { HistoryPage, HistoryRow } from '../../shared/types/history';
import type { HistoryQuery } from '../../shared/validation/history-input';
import { saleBalanceSql } from './sale-balance-sql';
import { expenseInput, type ExpenseInput, type ExpenseFilters } from '../../shared/validation/expense-input';
import { importedProduct, type ProductImport } from '../../shared/validation/product-import';
import { expenseReceiptUpload, type ExpenseReceiptUpload } from '../../shared/validation/expense-receipt';

type Discrepancy = { event: string; item: string; kind: 'damage' | 'shortage' };
export type ClaimCommand = (Discrepancy & { action: 'claim'; reference: string; notes: string; claimant: string;
  currency: Currency; amount: number; rate: number })
  | { action: 'decide'; claim: string; accepted: number; notes: string }
  | (Discrepancy & { action: 'credit' | 'cash' | 'recover' | 'loss' | 'return'; reference: string; notes: string; account?: string; quantity?: number; payable_minor?: number; close_missing?: boolean })
  | { action: 'reverse'; resolution: string; reference: string; notes: string };

type PurchaseReceiptStatus = PurchaseItem & {
  received_quantity: number; damaged_quantity: number; reserved_quantity: number; closed_quantity: number;
};
type ManifestProgress = {
  purchase_item_id: string; expected: number; usable: number; damaged: number; missing: number; outstanding: number;
};

const now = () => new Date().toISOString();
const sum = <T>(rows: T[], value: (row: T) => number) => rows.reduce((total, row) => total + value(row), 0);
type ProductInput = Omit<Product, 'id' | 'created_at'>;
type Line = { product_id: string; quantity: number };
type SaleLine = Line & { price?: number; unit_discount?: number };
type PaymentInput = Omit<Payment, 'id' | 'payment_date' | 'reference_number' | 'reversed'> & { reference_number?: string; account?: string };
type CheckoutPayment = Pick<PaymentInput, 'amount' | 'method' | 'reference_number' | 'account'>;
type FinanceEntry = {
  kind: 'expense' | 'transfer' | 'opening' | 'supplier_payment' | 'shipment_payment' | 'exchange';
  amount: number; reference: string; account: string; destination?: string; category?: string; purchase?: string; shipment?: string;
  rate?: number; received?: number; fee?: number; payable_minor?: number; settled_on?: string;
  expense_details?: string; expense_request?: string;
};
type Account = { id: string; name: string; kind: string; currency: Currency; active: number };
export class BusinessError extends Error {}

export class DataStore {
  constructor(private readonly connect: () => BusinessDatabase) {}

  private get db() { return this.connect(); }
  private all<T>(sql: string, ...params: SQLInputValue[]) { return this.db.prepare(sql).all(...params) as T[]; }
  private one<T>(sql: string, ...params: SQLInputValue[]) { return this.db.prepare(sql).get(...params) as T | undefined; }
  private run(sql: string, ...params: SQLInputValue[]) { this.db.prepare(sql).run(...params); }
  private write<T>(work: () => T) { return transaction(this.db, work); }

  private audit(actor: string, action: string, entity: string) {
    this.run('INSERT INTO audit_log VALUES (?, ?, ?, ?, ?)', id(), actor, action, entity, now());
  }

  getUserByEmail(email: string) { return this.one<User>('SELECT * FROM users WHERE email = ?', email.trim()); }
  getUserById(key: string) { return this.one<User>('SELECT * FROM users WHERE id = ?', key); }

  savePasswordReset(owner: User, tokenHash: string, expiresAt: number) {
    return this.write(() => {
      const current = this.getUserById(owner.id);
      if (current?.role !== 'admin' || current.email !== owner.email || current.password_hash !== owner.password_hash) return false;
      if (this.one('SELECT 1 FROM password_resets WHERE owner_id=? AND expires_at>?', owner.id, expiresAt - 60_000)) return false;
      this.run(`INSERT INTO password_resets (owner_id,token_hash,expires_at) VALUES (?,?,?)
        ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at`,
      owner.id, tokenHash, expiresAt);
      return true;
    });
  }

  deletePasswordReset(tokenHash: string) {
    this.run('DELETE FROM password_resets WHERE token_hash=?', tokenHash);
  }

  getPasswordReset(tokenHash: string, time: number) {
    return this.one<User>(`SELECT u.* FROM password_resets r JOIN users u ON u.id=r.owner_id
      WHERE r.token_hash=? AND r.expires_at>? AND u.role='admin'`, tokenHash, time);
  }

  resetOwnerPassword(tokenHash: string, passwordHash: string) {
    return this.write(() => {
      const user = this.getPasswordReset(tokenHash, Date.now());
      if (!user) return false;
      this.run('UPDATE users SET password_hash=? WHERE id=?', passwordHash, user.id);
      this.run('DELETE FROM password_resets WHERE owner_id=?', user.id);
      this.audit(user.id, 'owner.password_reset', user.id);
      return true;
    });
  }

  getSettings() {
    return this.one<{ name: string; address: string; phone: string; receipt_footer: string }>('SELECT name, address, phone, receipt_footer FROM business_settings WHERE id = 1')!;
  }

  getPreferences(): Preferences {
    const row = this.one<{ categories: string; channels: string; expense_categories: string; payment_labels: string; cny_rate_micros: number | null; usd_rate_micros: number | null }>(
      'SELECT categories, channels, expense_categories, payment_labels, cny_rate_micros, usd_rate_micros FROM business_settings WHERE id = 1')!;
    return { ...row, categories: JSON.parse(row.categories), channels: JSON.parse(row.channels),
      expense_categories: JSON.parse(row.expense_categories), payment_labels: JSON.parse(row.payment_labels) };
  }

  saveSettings(input: ReturnType<DataStore['getSettings']>, actor: string, preferences?: Preferences) {
    return this.write(() => {
      this.run('UPDATE business_settings SET name = ?, address = ?, phone = ?, receipt_footer = ? WHERE id = 1',
        input.name, input.address, input.phone, input.receipt_footer);
      if (preferences) this.run(`UPDATE business_settings SET categories = ?, channels = ?, payment_labels = ?,
        cny_rate_micros = ?, usd_rate_micros = ? WHERE id = 1`, JSON.stringify(preferences.categories),
      JSON.stringify(preferences.channels), JSON.stringify(preferences.payment_labels), preferences.cny_rate_micros, preferences.usd_rate_micros);
      if (preferences?.expense_categories) this.run('UPDATE business_settings SET expense_categories=? WHERE id=1', JSON.stringify(preferences.expense_categories));
      this.audit(actor, 'business.updated', '1');
      return this.getSettings();
    });
  }

  updateOwner(input: { name: string; email: string; current: string; password?: string }, actor: string) {
    const user = this.getUserById(actor);
    if (!user || !bcrypt.compareSync(input.current, user.password_hash)) throw new BusinessError('The current password is incorrect.');
    const hash = input.password ? bcrypt.hashSync(input.password, 12) : user.password_hash;
    return this.write(() => {
      if (this.getUserById(actor)?.password_hash !== user.password_hash) throw new BusinessError('The owner account changed. Please retry.');
      this.run('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?', input.name, input.email, hash, actor);
      if (hash !== user.password_hash || input.email !== user.email) {
        this.run('DELETE FROM password_resets WHERE owner_id=?', actor);
      }
      this.audit(actor, 'owner.updated', actor);
      return { name: input.name, email: input.email };
    });
  }

  getContactDirectory() {
    return this.all<{ id: string; kind: string; name: string; phone: string; email: string; location: string }>(
      'SELECT * FROM contacts ORDER BY kind, name');
  }

  getContacts() {
    return this.getContactDirectory().map(contact => {
      const sales = contact.kind === 'Customer' ? this.all<Sale>(
        'SELECT * FROM sales WHERE customer_id = ? ORDER BY sale_date DESC', contact.id) : [];
      const purchases = contact.kind === 'Supplier' ? this.all<Purchase>(
        'SELECT * FROM purchases WHERE supplier_id = ? ORDER BY purchase_date DESC', contact.id) : [];
      const orders = contact.kind === 'Customer' ? this.all<{ id: string; status: string; source: string }>(
        'SELECT id, status, source FROM online_orders WHERE customer_id = ? ORDER BY created_at DESC', contact.id) : [];
      return { ...contact, sales, purchases, orders,
        balance: sum(sales, sale => this.saleBalance(sale.id)) + sum(purchases, purchase => purchase.total_amount - this.supplierPaid(purchase.id)) };
    });
  }

  saveContact(input: { id?: string; create?: boolean; kind: string; name: string; phone: string; email: string; location: string }, actor: string) {
    return this.write(() => {
      if (input.id) this.contactName(input.id, input.kind);
      const matches = !input.id && !input.create
        ? this.all<{ id: string }>('SELECT id FROM contacts WHERE kind = ? AND name = ?', input.kind, input.name) : [];
      if (matches.length > 1) throw new BusinessError('Choose a contact by its ID.');
      const key = input.id ?? matches[0]?.id ?? id();
      this.run(`INSERT INTO contacts VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id)
        DO UPDATE SET name = excluded.name, phone = excluded.phone, email = excluded.email, location = excluded.location`,
      key, input.kind, input.name, input.phone, input.email, input.location);
      this.audit(actor, 'contact.saved', key);
      return { id: key };
    });
  }

  private contactName(key: string, kind: string) {
    const contact = this.one<{ name: string }>('SELECT name FROM contacts WHERE id = ? AND kind = ?', key, kind);
    if (!contact) throw new BusinessError(`Choose a valid ${kind.toLowerCase()} contact.`);
    return contact.name;
  }

  getUnlinkedContacts() {
    return this.all<{ id: string; kind: 'sale' | 'purchase' | 'order'; name: string; recorded_at: string }>(`
      SELECT id, 'sale' AS kind, customer_name AS name, sale_date AS recorded_at FROM sales WHERE customer_id IS NULL AND customer_name IS NOT NULL
      UNION ALL SELECT id, 'purchase', supplier_name, purchase_date FROM purchases WHERE supplier_id IS NULL
      UNION ALL SELECT id, 'order', customer_name, created_at FROM online_orders WHERE customer_id IS NULL
      ORDER BY recorded_at DESC`);
  }

  linkContact(key: string, kind: 'sale' | 'purchase' | 'order', contact: string, actor: string) {
    return this.write(() => {
      this.contactName(contact, kind === 'purchase' ? 'Supplier' : 'Customer');
      if (kind === 'purchase') {
        if (!this.one('SELECT id FROM purchases WHERE id = ? AND supplier_id IS NULL', key)) throw new BusinessError('Choose an unlinked purchase.');
        this.run('UPDATE purchases SET supplier_id = ? WHERE id = ?', contact, key);
      } else {
        const order = kind === 'order'
          ? this.one<{ id: string; sale_id: string | null; customer_id: string | null }>('SELECT id, sale_id, customer_id FROM online_orders WHERE id = ?', key)
          : this.one<{ id: string; sale_id: string | null; customer_id: string | null }>('SELECT id, sale_id, customer_id FROM online_orders WHERE sale_id = ?', key);
        const sale = kind === 'sale' || order?.sale_id
          ? this.one<{ id: string; customer_id: string | null }>('SELECT id, customer_id FROM sales WHERE id = ?', kind === 'sale' ? key : order?.sale_id ?? '')
          : undefined;
        if ((kind === 'order' && !order) || (kind === 'sale' && !sale) ||
          [order?.customer_id, sale?.customer_id].some(value => value && value !== contact)) throw new BusinessError('This transaction cannot be linked to that contact.');
        if (order) this.run('UPDATE online_orders SET customer_id = ? WHERE id = ?', contact, order.id);
        if (sale) this.run('UPDATE sales SET customer_id = ? WHERE id = ?', contact, sale.id);
      }
      this.audit(actor, 'contact.linked', key);
      return { id: key };
    });
  }

  provisionOwner(name: string, email: string, password: string) {
    return this.write(() => {
      if (this.one('SELECT id FROM users LIMIT 1')) throw new BusinessError('An owner is already configured.');
      const owner = id();
      this.run('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)', owner, name, email.trim(), bcrypt.hashSync(password, 12), 'admin', now());
      this.audit(owner, 'owner.provisioned', owner);
      return owner;
    });
  }

  getProducts() {
    return this.all<Product>(`SELECT p.*, f.name AS family, EXISTS(SELECT 1 FROM product_images WHERE product_id = p.id) AS has_image,
      (SELECT COALESCE(SUM(quantity - received_quantity - damaged_quantity - closed_quantity), 0) FROM purchase_receiving_status WHERE product_id = p.id) AS awaiting_receipt,
      (SELECT COALESCE(SUM(damaged_quantity), 0) FROM purchase_receiving_status WHERE product_id = p.id)
        + (SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE product_id = p.id AND disposition = 'Damaged') AS damaged_recorded,
      (SELECT COALESCE(SUM(r.missing), 0) FROM shipment_receiving_lines r JOIN purchase_items i ON i.id = r.purchase_item_id WHERE i.product_id = p.id)
        + (SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE product_id = p.id AND disposition = 'Missing') AS missing_recorded
      FROM products p LEFT JOIN product_families f ON f.id = p.family_id WHERE p.archived_at IS NULL ORDER BY p.created_at DESC`);
  }
  getProductById(key: string) {
    return this.one<Product>(`SELECT p.*, f.name AS family, EXISTS(SELECT 1 FROM product_images WHERE product_id = p.id) AS has_image
      FROM products p LEFT JOIN product_families f ON f.id = p.family_id WHERE p.id = ? AND p.archived_at IS NULL`, key);
  }

  getProductImage(key: string) {
    return this.one<{ content_type: string; contents: Uint8Array }>('SELECT content_type, contents FROM product_images WHERE product_id = ?', key);
  }

  saveProductImage(key: string, contentType: string, bytes: Uint8Array, actor: string) {
    return this.write(() => {
      this.product(key);
      this.run(`INSERT INTO product_images VALUES (?, ?, ?) ON CONFLICT(product_id)
        DO UPDATE SET content_type = excluded.content_type, contents = excluded.contents`, key, contentType, bytes);
      this.audit(actor, 'product.image_saved', key);
      return { id: key };
    });
  }

  private product(key: string) {
    const row = this.getProductById(key);
    if (!row) throw new BusinessError('Product is unavailable.');
    return row;
  }

  private checkSku(sku: string, key: string) {
    if (this.one('SELECT id FROM products WHERE sku = ? AND id <> ?', sku, key)) throw new BusinessError('This SKU already exists.');
  }

  private saveVariant(key: string, product: Partial<ProductInput>) {
    const family = product.family?.trim();
    if (family) this.run('INSERT INTO product_families VALUES (?, ?) ON CONFLICT(name) DO NOTHING', id(), family);
    this.run(`UPDATE products SET family_id = (SELECT id FROM product_families WHERE name = ?),
      variant_size = ?, variant_color = ?, variant_material = ?, variant_design = ? WHERE id = ?`,
      family ?? null, product.variant_size ?? '', product.variant_color ?? '', product.variant_material ?? '', product.variant_design ?? '', key);
  }

  createProduct(input: ProductInput, actor: string) {
    return this.write(() => this.insertProduct(input, actor));
  }

  private insertProduct(input: ProductInput, actor: string) {
      const key = id();
      const sku = input.sku?.trim() || key.toUpperCase();
      this.checkSku(sku, key);
      this.run(`INSERT INTO products (id, sku, name, category, description, purchase_price, selling_price, quantity, minimum_quantity, supplier, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        key, sku, input.name, input.category, input.description ?? '', input.purchase_price, input.selling_price,
        input.minimum_quantity, input.supplier, now());
      this.saveVariant(key, input);
      if (input.quantity) this.adjust(this.product(key), input.quantity, 'Opening stock', actor);
      this.audit(actor, 'product.created', key);
      return this.product(key);
  }

  previewProductImport(input: ProductImport) {
    const seen = new Set<string>();
    return input.rows.map((raw, index) => {
      const result = importedProduct.safeParse(raw);
      if (!result.success) return { row: index + 2, sku: String(raw.sku ?? ''), error: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('. ') };
      const product = result.data;
      const sku = product.sku.toLowerCase();
      let error = '';
      if (seen.has(sku)) error = 'Duplicate SKU in this file.';
      else if (this.one('SELECT id FROM products WHERE sku = ?', product.sku)) error = 'This SKU already exists.';
      else if (input.opening_stock && product.quantity > 0 && !product.purchase_price) error = 'Opening stock requires a positive unit cost.';
      seen.add(sku);
      return { row: index + 2, sku: product.sku, product: { ...product, quantity: input.opening_stock ? product.quantity : 0 }, error };
    });
  }

  confirmProductImport(input: ProductImport, actor: string) {
    return this.write(() => {
      const rows = this.previewProductImport(input);
      if (rows.some(row => row.error || !row.product)) throw new BusinessError('Resolve every invalid or duplicate row before importing.');
      return { count: rows.map(row => this.insertProduct(row.product!, actor)).length };
    });
  }

  updateProduct(key: string, input: Partial<ProductInput>, actor: string) {
    return this.write(() => {
      const previous = this.product(key);
      const updated = { ...previous, ...input };
      const sku = updated.sku?.trim() || previous.sku || key;
      this.checkSku(sku, key);
      this.run('UPDATE products SET sku = ?, name = ?, category = ?, description = ?, selling_price = ?, minimum_quantity = ?, supplier = ? WHERE id = ?',
        sku, updated.name, updated.category, updated.description ?? '', updated.selling_price, updated.minimum_quantity, updated.supplier, key);
      this.saveVariant(key, updated);
      this.audit(actor, 'product.updated', key);
      return this.product(key);
    });
  }

  deleteProduct(key: string, actor: string) {
    return this.write(() => {
      const product = this.getProductById(key);
      if (!product) return false;
      if (product.quantity) throw new BusinessError('Adjust stock to zero before archiving.');
      if (this.one(`SELECT id FROM purchase_receiving_status WHERE product_id = ? AND quantity > received_quantity + damaged_quantity + closed_quantity`, key)) {
        throw new BusinessError('This product has an open purchase line.');
      }
      this.run('UPDATE products SET archived_at = ? WHERE id = ?', now(), key);
      this.audit(actor, 'product.archived', key);
      return true;
    });
  }

  private adjust(product: Product, delta: number, reason: string, actor: string, purchase?: string, sale?: string, incomingCost?: number) {
    const balance = product.quantity + delta;
    if (balance < 0) throw new BusinessError(`${product.name} has only ${product.quantity} units available.`);
    const movement = { id: id(), product_id: product.id, product_name: product.name,
      type: delta > 0 ? 'Stock In' : 'Stock Out', quantity: Math.abs(delta),
      movement_date: now(), remaining_stock: balance, reason };
    const currentValue = product.stock_value ?? 0;
    const value = delta > 0
      ? currentValue + (incomingCost ?? (product.quantity ? roundedShare(currentValue, delta, product.quantity) : delta * product.purchase_price))
      : currentValue - roundedShare(currentValue, -delta, product.quantity);
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(value)) throw new BusinessError('Inventory balance exceeds the supported range.');
    this.run('UPDATE products SET quantity = ?, stock_value = ?, purchase_price = ? WHERE id = ?',
      balance, value, balance ? roundedShare(value, 1, balance) : product.purchase_price, product.id);
    this.run(`INSERT INTO stock_movements (id, product_id, product_name, type, quantity, movement_date, remaining_stock,
      reason, actor_id, purchase_item_id, sale_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, movement.id,
      product.id, product.name, movement.type, movement.quantity, movement.movement_date, balance, reason, actor, purchase ?? null, sale ?? null);
    this.audit(actor, 'stock.moved', movement.id);
    return movement;
  }

  getStockMovements() { return this.all<StockMovement>('SELECT * FROM stock_movements ORDER BY movement_date DESC, rowid DESC'); }

  getStockCounts() {
    return this.all(`SELECT c.*, p.name FROM stock_counts c JOIN products p ON p.id = c.product_id
      ORDER BY recorded_at DESC, c.rowid DESC`);
  }

  countStock(key: string, expected: number, counted: number, reason: string, actor: string) {
    return this.write(() => {
      const product = this.product(key);
      if (product.quantity !== expected) throw new BusinessError('Available stock changed. Reload and check the physical quantity again.');
      const delta = counted - expected;
      const movement = delta ? this.adjust(product, delta, `Stock count: ${reason}`, actor) : null;
      const count = id();
      this.run('INSERT INTO stock_counts VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        count, product.id, expected, counted, reason, actor, movement?.id ?? null, now());
      this.audit(actor, 'stock.counted', count);
      return { id: count };
    });
  }

  moveStock(key: string, quantity: number, type: StockMovement['type'], reason: string, actor: string, disposition?: 'Damaged' | 'Missing') {
    return this.write(() => {
      if (disposition && type !== 'Stock Out') throw new BusinessError('Only outgoing stock can be marked damaged or missing.');
      const movement = this.adjust(this.product(key), type === 'Stock In' ? quantity : -quantity, reason, actor);
      if (disposition) this.run('UPDATE stock_movements SET disposition = ? WHERE id = ?', disposition, movement.id);
      return { ...movement, disposition };
    });
  }

  getPurchases() {
    return this.all<Purchase>('SELECT * FROM purchases ORDER BY purchase_date DESC').map(purchase => ({
      ...purchase,
      balance: purchase.total_amount - this.supplierPaid(purchase.id),
      items: this.all<PurchaseReceiptStatus>('SELECT * FROM purchase_receiving_status WHERE purchase_id = ?', purchase.id),
    }));
  }

  createPurchase(supplier: string, items: (Line & { unit_cost: number })[], actor: string,
    currency: NonNullable<Purchase['currency']> = 'RWF', rate = 1000000, invoice = '', contact?: string, requestKey?: string) {
    return this.write(() => {
      const payload = JSON.stringify({ supplier, items, currency, rate, invoice, contact });
      const prior = requestKey ? this.one<Purchase & { request_payload: string; actor_id: string }>('SELECT * FROM purchases WHERE request_key=?', requestKey) : undefined;
      if (prior) {
        if (prior.actor_id !== actor || prior.request_payload !== payload) throw new BusinessError('This purchase key belongs to a different order.');
        return prior;
      }
      const key = id();
      const time = now();
      const divisor = currency === 'RWF' ? 1000000 : 100000000;
      const costs = items.map(line => roundedShare(line.quantity * line.unit_cost, rate, divisor));
      const total = sum(costs, cost => cost);
      if (!Number.isSafeInteger(total) || total > 1000000000000) throw new BusinessError('Purchase total exceeds the supported RWF range.');
      const name = contact ? this.contactName(contact, 'Supplier') : supplier;
      this.run(`INSERT INTO purchases (id, supplier_name, total_amount, purchase_date, created_at, actor_id, currency, rate_micros, invoice_reference, supplier_id,request_key,request_payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, key, name, total, time, time, actor, currency, rate, invoice, contact ?? null, requestKey ?? null, requestKey ? payload : null);
      for (const [index, line] of items.entries()) {
        this.product(line.product_id);
        this.run('INSERT INTO purchase_items VALUES (?, ?, ?, ?, ?, ?, ?)', id(), key, line.product_id,
          line.quantity, roundedShare(costs[index], 1, line.quantity), costs[index], line.unit_cost);
      }
      this.audit(actor, 'purchase.created', key);
      return { id: key, supplier_name: name, total_amount: total, purchase_date: time, created_at: time };
    });
  }

  receivePurchaseItem(itemId: string, quantity: number, actor: string, reference?: string) {
    return this.write(() => {
      const existing = reference ? this.one<StockMovement & { purchase_item_id: string }>(
        'SELECT * FROM stock_movements WHERE receipt_reference = ?', reference) : undefined;
      if (existing) {
        if (existing.purchase_item_id !== itemId || existing.quantity !== quantity) throw new BusinessError('That receipt reference has already been used.');
        return existing;
      }
      const { item, cost } = this.receiptCost(itemId, quantity);
      const movement = this.adjust(this.product(item.product_id), quantity, 'Confirmed purchase receipt', actor, itemId, undefined, cost);
      if (reference) this.run('UPDATE stock_movements SET receipt_reference = ? WHERE id = ?', reference, movement.id);
      return movement;
    });
  }

  private receiptCost(itemId: string, quantity: number, reservation = 0) {
    const item = this.one<PurchaseReceiptStatus>('SELECT * FROM purchase_receiving_status WHERE id = ?', itemId);
    if (!item) throw new BusinessError('Purchase line was not found.');
    const received = item.received_quantity + item.damaged_quantity + item.closed_quantity;
    if (received + quantity + item.reserved_quantity - reservation > item.quantity) {
      throw new BusinessError('Receipt exceeds the remaining ordered quantity available outside other manifest reservations.');
    }
    const cost = roundedShare(item.subtotal, received + quantity, item.quantity) - roundedShare(item.subtotal, received, item.quantity);
    return { item, cost, quantity, received };
  }

  getShipments() {
    return this.all<{ id: string; reference: string; agent: string; status: string; expenses: number; paid: number; landed_cost: number; created_at: string }>(`SELECT s.*,
      (SELECT COALESCE(SUM(amount), 0) FROM shipment_expenses WHERE shipment_id = s.id) AS expenses,
      (SELECT COALESCE(SUM(amount), 0) FROM money_transactions m WHERE shipment_id = s.id
        AND NOT EXISTS (SELECT 1 FROM money_reversals WHERE transaction_id = m.id)) AS paid,
      (SELECT COALESCE(SUM(supplier_cost + allocated_expense), 0) FROM shipment_receipt_items WHERE shipment_id = s.id)
      + (SELECT COALESCE(SUM(supplier_cost + capitalized_expense), 0) FROM shipment_receiving_lines WHERE shipment_id = s.id) AS landed_cost
      FROM shipments s ORDER BY created_at DESC`).map(shipment => ({
      ...shipment,
      charges: this.all<{ kind: string; amount: number }>('SELECT kind,amount FROM shipment_expenses WHERE shipment_id=? ORDER BY kind',shipment.id),
      legacy_receipts: this.all<{ product_name: string; quantity: number; recorded_at: string; landed_cost: number }>(
        `SELECT m.product_name, m.quantity, m.movement_date AS recorded_at, r.supplier_cost + r.allocated_expense AS landed_cost
          FROM shipment_receipt_items r JOIN stock_movements m ON m.id = r.movement_id WHERE r.shipment_id = ?`, shipment.id),
      manifest: this.one<Omit<ShipmentManifest, 'lines'> & { allocation: string | null }>(
        'SELECT * FROM shipment_manifests WHERE shipment_id = ?', shipment.id),
      lines: this.all<ManifestProgress & { purchase_id: string; product_name: string; supplier_name: string }>(
        `SELECT m.*, i.purchase_id, p.name AS product_name, o.supplier_name FROM shipment_manifest_progress m
          JOIN purchase_items i ON i.id = m.purchase_item_id JOIN products p ON p.id = i.product_id
          JOIN purchases o ON o.id = i.purchase_id WHERE m.shipment_id = ? ORDER BY m.purchase_item_id`, shipment.id),
      events: this.all<{ id: string; reference: string; recorded_at: string; actor_name: string }>(
        `SELECT e.id, e.reference, e.recorded_at, u.name AS actor_name FROM shipment_receiving_events e
          JOIN users u ON u.id = e.actor_id WHERE e.shipment_id = ? ORDER BY e.recorded_at DESC, e.rowid DESC`, shipment.id)
        .map(event => ({ ...event, lines: this.all<ShipmentEvent['lines'][number] & {
          supplier_cost: number; damaged_supplier_cost: number; allocated_expense: number; capitalized_expense: number; movement_id: string | null;
        }>(`SELECT r.*, purchase_item_id AS item_id FROM shipment_receiving_lines r WHERE event_id = ?`, event.id) })),
    }));
  }

  createShipment(reference: string, agent: string, actor: string, manifest?: ShipmentManifest) {
    return this.write(() => {
      const key = id();
      if (this.one('SELECT id FROM shipments WHERE reference = ?', reference)) throw new BusinessError('Shipment reference already exists.');
      this.run("INSERT INTO shipments VALUES (?, ?, ?, 'Planned', ?, ?)", key, reference, agent, now(), actor);
      if (manifest) {
        this.run('INSERT INTO shipment_manifests VALUES (?, ?, ?, ?, ?, ?, NULL)',
          key, manifest.origin, manifest.destination, manifest.expected_date, manifest.notes, manifest.expected_expenses);
        this.checkShipmentLines(manifest.lines);
        for (const line of manifest.lines) {
          this.receiptCost(line.item_id, line.quantity);
          this.run('INSERT INTO shipment_manifest_lines VALUES (?, ?, ?)', key, line.item_id, line.quantity);
        }
      }
      this.audit(actor, 'shipment.created', key);
      return { id: key };
    });
  }

  dispatchShipment(key: string, actor: string) {
    return this.write(() => {
      const shipment = this.getShipments().find(row => row.id === key);
      if (shipment?.status !== 'Planned') throw new BusinessError('Only a planned shipment can be dispatched.');
      this.run("UPDATE shipments SET status = 'In transit' WHERE id = ?", key);
      this.audit(actor, 'shipment.dispatched', key);
      return { id: key };
    });
  }

  receiveShipment(key: string, lines: { item_id: string; quantity: number }[], expenses: Record<string, number>,
    allocation: 'quantity' | 'value', actor: string) {
    return this.write(() => {
      const shipment = this.getShipments().find(row => row.id === key);
      if (!shipment || shipment.status === 'Received') throw new BusinessError('Choose an open shipment.');
      if (shipment.manifest) throw new BusinessError('Record a receiving event against the manifest.');
      this.checkShipmentLines(lines);
      const received = lines.map(line => this.receiptCost(line.item_id, line.quantity));
      const totalExpenses = sum(Object.values(expenses), amount => amount);
      const weights = received.map(row => allocation === 'value' ? row.cost : row.quantity);
      if (!weights.some(Boolean)) throw new BusinessError('Choose quantity allocation when all supplier costs are zero.');
      const shares = allocateCost(totalExpenses, weights);
      for (const [kind, amount] of Object.entries(expenses)) {
        this.run('INSERT INTO shipment_expenses VALUES (?, ?, ?)', key, kind, amount);
      }
      for (const [index, row] of received.entries()) {
        const product = this.product(row.item.product_id);
        const movement = this.adjust(product, row.quantity, `Shipment ${shipment.reference}`, actor, row.item.id, undefined, row.cost + shares[index]);
        this.run('INSERT INTO shipment_receipt_items VALUES (?, ?, ?, ?, ?)', key, row.item.id, movement.id, row.cost, shares[index]);
      }
      this.run("UPDATE shipments SET status = 'Received' WHERE id = ?", key);
      this.audit(actor, 'shipment.received', key);
      return { id: key };
    });
  }

  private checkShipmentLines(lines: { item_id: string }[]) {
    if (!lines.length || new Set(lines.map(line => line.item_id)).size !== lines.length) {
      throw new BusinessError('Enter one or more distinct purchase lines.');
    }
  }

  recordShipmentEvent(input: ShipmentEvent, actor: string) {
    return this.write(() => {
      const lines = [...input.lines].sort((a, b) => a.item_id.localeCompare(b.item_id));
      const payload = JSON.stringify({ lines, charges: input.charges });
      const previous = this.one<{ id: string; shipment_id: string; payload: string }>(
        'SELECT id, shipment_id, payload FROM shipment_receiving_events WHERE reference = ?', input.reference);
      if (previous) {
        if (previous.shipment_id !== input.id || previous.payload !== payload) throw new BusinessError('Receipt reference already belongs to a different event.');
        return { id: previous.id };
      }
      const shipment = this.getShipments().find(row => row.id === input.id);
      if (!shipment?.manifest || shipment.status === 'Received') throw new BusinessError('Choose an open shipment with a manifest.');
      this.checkShipmentLines(lines);
      const allocation = shipment.manifest.allocation ?? input.charges?.allocation;
      if (!allocation) throw new BusinessError('Enter actual shipment charges and an allocation method on the first receipt.');
      if (shipment.manifest.allocation && input.charges) throw new BusinessError('Shipment charges are already locked.');
      const total = input.charges ? sum(Object.values(input.charges.expenses), amount => amount) : shipment.expenses;
      const weights = shipment.lines.map(line => {
        if (allocation === 'quantity') return line.expected;
        const item = this.one<PurchaseItem>('SELECT * FROM purchase_items WHERE id = ?', line.purchase_item_id)!;
        return roundedShare(item.subtotal, line.expected, item.quantity);
      });
      if (!weights.some(Boolean) && total) throw new BusinessError('Choose quantity allocation for a shipment with zero supplier value.');
      const budgets = allocateCost(total, weights.some(Boolean) ? weights : shipment.lines.map(line => line.expected));
      if (input.charges) {
        this.run('UPDATE shipment_manifests SET allocation = ? WHERE shipment_id = ?', allocation, input.id);
        for (const [kind, amount] of Object.entries(input.charges.expenses)) {
          this.run('INSERT INTO shipment_expenses VALUES (?, ?, ?)', input.id, kind, amount);
        }
      }
      const event = id();
      this.run('INSERT INTO shipment_receiving_events VALUES (?, ?, ?, ?, ?, ?)', event, input.id, input.reference, payload, now(), actor);
      for (const line of lines) {
        const index = shipment.lines.findIndex(row => row.purchase_item_id === line.item_id);
        const plan = shipment.lines[index];
        const resolved = line.usable + line.damaged + line.missing;
        if (!plan || resolved > plan.outstanding) throw new BusinessError('The receipt exceeds the outstanding manifest quantity.');
        const { item, cost, received } = this.receiptCost(line.item_id, line.usable + line.damaged, plan.outstanding);
        const usableCost = roundedShare(item.subtotal, received + line.usable, item.quantity)
          - roundedShare(item.subtotal, received, item.quantity);
        const processed = plan.expected - plan.outstanding;
        const expenseAt = (quantity: number) => roundedShare(budgets[index], processed + quantity, plan.expected);
        const allocated = expenseAt(resolved) - expenseAt(0);
        const capitalized = expenseAt(line.usable) - expenseAt(0);
        const movement = line.usable
          ? this.adjust(this.product(item.product_id), line.usable, `Shipment ${shipment.reference} / ${input.reference}`,
            actor, item.id, undefined, usableCost + capitalized)
          : null;
        this.run('INSERT INTO shipment_receiving_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          event, input.id, item.id, line.usable, line.damaged, line.missing, line.explanation,
          usableCost, cost - usableCost, allocated, capitalized, movement?.id ?? null);
      }
      const outstanding = this.one('SELECT 1 FROM shipment_manifest_progress WHERE shipment_id = ? AND outstanding > 0', input.id);
      this.run('UPDATE shipments SET status = ? WHERE id = ?', outstanding ? 'In transit' : 'Received', input.id);
      this.audit(actor, 'shipment.receipt_recorded', event);
      return { id: event };
    });
  }

  getSales() {
    return this.all<Sale>('SELECT * FROM sales ORDER BY sale_date DESC').map(sale => ({
      ...sale, balance: this.saleBalance(sale.id), items: this.all<SaleItem & { cost: number; name: string; returned: number }>(
        `SELECT i.*, p.name, (SELECT COALESCE(SUM(quantity), 0) FROM sale_returns WHERE sale_item_id = i.id) AS returned
        FROM sale_items i JOIN products p ON p.id = i.product_id WHERE sale_id = ?`, sale.id),
    }));
  }

  getSaleReceipt(key: string) {
    const sale = this.one<Sale>('SELECT * FROM sales WHERE id = ?', key);
    if (!sale) return undefined;
    const credits = this.one<{ returned: number; refunded: number }>(`SELECT COALESCE(SUM(r.revenue_credit),0) AS returned,
      COALESCE(SUM(r.refund),0) AS refunded FROM sale_returns r JOIN sale_items i ON i.id = r.sale_item_id WHERE i.sale_id = ?`, key)!;
    return { ...sale, ...credits, balance: this.saleBalance(key), items: this.all<SaleItem & { name: string }>(
      'SELECT i.*, p.name FROM sale_items i JOIN products p ON p.id = i.product_id WHERE sale_id = ?', key),
      payments: this.all<{ method: string; reference_number: string; amount: number; name: string }>(
        `SELECT p.method,p.reference_number,p.amount,a.name FROM payments p JOIN money_transactions m ON m.payment_id = p.id
        JOIN accounts a ON a.id = m.to_account WHERE p.sale_id = ?
        AND NOT EXISTS (SELECT 1 FROM money_reversals r WHERE r.transaction_id = m.id)
        ORDER BY p.payment_date,p.id`, key) };
  }

  createSale(customer: string | null, method: Sale['payment_method'], items: SaleLine[], actor: string, paid?: number,
    channel = 'Physical shop', requestKey?: string, contact?: string, payments?: CheckoutPayment[]) {
    return this.write(() => {
      const payload = JSON.stringify({ customer, method, items, paid, channel, contact, payments });
      const existing = requestKey ? this.one<Sale & { request_payload: string | null }>(
        'SELECT * FROM sales WHERE request_key = ? AND actor_id = ?', requestKey, actor) : undefined;
      if (existing) {
        if (existing.request_payload && existing.request_payload !== payload) throw new BusinessError('This checkout key already belongs to a different sale.');
        return existing;
      }
      const sale = this.completeSale(contact ? this.contactName(contact, 'Customer') : customer, method, items, actor, paid, channel, contact, payments);
      if (requestKey) this.run('UPDATE sales SET request_key = ?, request_payload = ? WHERE id = ?', requestKey, payload, sale.id);
      return sale;
    });
  }

  private completeSale(customer: string | null, method: Sale['payment_method'], items: SaleLine[],
    actor: string, paid: number | undefined, channel: string, contact?: string, payments?: CheckoutPayment[]) {
      const key = id();
      const time = now();
      const priced = items.map(line => {
        const price = (line.price ?? this.product(line.product_id).selling_price) - (line.unit_discount ?? 0);
        if (price < 0) throw new BusinessError('A discount cannot exceed the unit price.');
        return { ...line, price };
      });
      const total = sum(priced, line => line.price * line.quantity);
      const payment = payments ? sum(payments, row => row.amount) : paid ?? (method === 'Credit' ? 0 : total);
      if (!Number.isSafeInteger(total) || payment > total || (!payments && method === 'Credit' && payment > 0)) throw new BusinessError('Invalid initial payment.');
      if (total > payment && !customer?.trim()) throw new BusinessError('A customer name is required for an unpaid sale.');
    this.run('INSERT INTO sales (id, customer_name, total_amount, payment_method, sale_date, created_at, actor_id, channel, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      key, customer, total, method, time, time, actor, channel, contact ?? null);
      for (const line of priced) {
        const product = this.product(line.product_id);
        const item = id();
        if (line.quantity > product.quantity) throw new BusinessError(`${product.name} has only ${product.quantity} units available.`);
        const price = line.price;
        this.run('INSERT INTO sale_items VALUES (?, ?, ?, ?, ?, ?, ?)', item, key, product.id, line.quantity,
          price, line.quantity * price, roundedShare(product.stock_value ?? 0, line.quantity, product.quantity));
        this.adjust(product, -line.quantity, 'Completed sale', actor, undefined, item);
      }
      const postings = payments ?? (payment ? [{ amount: payment, method }] : []);
      for (const posting of postings) this.recordPayment({ ...posting, sale_id: key, status: 'Paid' }, actor);
      this.audit(actor, 'sale.completed', key);
      return { id: key, customer_name: customer, total_amount: total, payment_method: method, sale_date: time, created_at: time, channel };
  }

  getOnlineOrders() {
    return this.all<{ id: string; customer_name: string; customer_id: string | null; contact: string; source: string; status: string; delivery_status: string; sale_id: string | null }>(
      'SELECT * FROM online_orders ORDER BY created_at DESC').map(order => ({
      ...order, items: this.all<Line & { price: number; name: string }>(`SELECT i.*, p.name FROM online_order_items i
        JOIN products p ON p.id = i.product_id WHERE i.order_id = ?`, order.id),
      balance: order.sale_id ? this.saleBalance(order.sale_id) : null,
    }));
  }

  private saleBalance(key: string) {
    return this.one<{ balance: number }>(`SELECT ${saleBalanceSql} AS balance FROM sales s WHERE id = ?`, key)?.balance ?? 0;
  }

  getReturns() {
    return this.all<{ id: string; sale_id: string; sale_item_id: string; recorded_at: string; reason: string;
      quantity: number; revenue_credit: number; cost_credit: number; refund: number; channel: string;
      product_id: string; name: string }>(`SELECT r.*, i.sale_id, i.product_id, p.name, s.channel FROM sale_returns r
      JOIN sale_items i ON i.id = r.sale_item_id JOIN products p ON p.id = i.product_id
      JOIN sales s ON s.id = i.sale_id ORDER BY r.recorded_at DESC`);
  }

  returnSaleItem(input: { item: string; quantity: number; reason: string; restock: boolean; account?: string; reference: string }, actor: string) {
    return this.write(() => {
      if (this.one('SELECT id FROM sale_returns WHERE reference = ?', input.reference)) throw new BusinessError('That return reference already exists.');
      const item = this.one<SaleItem & { cost: number }>('SELECT * FROM sale_items WHERE id = ?', input.item);
      if (!item) throw new BusinessError('Sale line was not found.');
      const returned = this.one<{ total: number }>('SELECT COALESCE(SUM(quantity), 0) AS total FROM sale_returns WHERE sale_item_id = ?', item.id)!.total;
      if (input.quantity + returned > item.quantity) throw new BusinessError('Return exceeds the quantity sold.');
      const revenue = input.quantity * item.selling_price;
      const refund = Math.max(0, revenue - this.saleBalance(item.sale_id));
      const original = refund && !input.account ? this.all<{ id: string }>(`SELECT DISTINCT a.id FROM payments p
        JOIN money_transactions m ON m.payment_id = p.id JOIN accounts a ON a.id = m.to_account
        WHERE p.sale_id = ? AND a.currency = 'RWF' AND a.active = 1
        AND NOT EXISTS (SELECT 1 FROM money_reversals r WHERE r.transaction_id = m.id)`, item.sale_id) : [];
      const account = refund ? input.account || (original.length === 1 ? original[0].id : null) : null;
      if (refund && (!account || this.account(account).currency !== 'RWF' || this.balance(account) < refund)) {
        throw new BusinessError(`Choose a funded RWF refund account for RWF ${refund}.`);
      }
      const cost = input.restock
        ? roundedShare(item.cost, returned + input.quantity, item.quantity) - roundedShare(item.cost, returned, item.quantity)
        : 0;
      const movement = input.restock ? this.adjust(this.product(item.product_id), input.quantity, `Sale return: ${input.reason}`, actor, undefined, item.id, cost) : null;
      const key = id();
      this.run('INSERT INTO sale_returns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', key, item.id, input.quantity,
        input.reason, now(), revenue, cost, refund, account, movement?.id ?? null, actor, input.reference);
      this.audit(actor, 'sale.returned', key);
      return { id: key, refund };
    });
  }

  createOnlineOrder(customer: string, contact: string, source: string, items: Line[], actor: string, customerId?: string) {
    return this.write(() => {
      if (new Set(items.map(item => item.product_id)).size !== items.length) throw new BusinessError('Enter each product once.');
      const key = id();
      this.run(`INSERT INTO online_orders (id, customer_name, contact, source, actor_id, created_at, customer_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, key, customerId ? this.contactName(customerId, 'Customer') : customer, contact, source, actor, now(), customerId ?? null);
      for (const item of items) {
        const product = this.product(item.product_id);
        this.run('INSERT INTO online_order_items VALUES (?, ?, ?, ?)', key, product.id, item.quantity, product.selling_price);
      }
      this.audit(actor, 'online_order.created', key);
      return { id: key };
    });
  }

  changeOnlineOrder(key: string, action: 'confirm' | 'cancel' | 'delivery', actor: string,
    method?: Sale['payment_method'], paid?: number, delivery?: string) {
    return this.write(() => {
      const order = this.getOnlineOrders().find(row => row.id === key);
      if (!order) throw new BusinessError('Order was not found.');
      if (action === 'delivery' && order.status === 'Confirmed' && delivery) {
        this.run('UPDATE online_orders SET delivery_status = ? WHERE id = ?', delivery, key);
      } else if (action === 'cancel' && order.status === 'Pending') {
        this.run("UPDATE online_orders SET status = 'Cancelled' WHERE id = ?", key);
      } else if (action === 'confirm' && order.status === 'Pending' && method) {
        const sale = this.completeSale(order.customer_name, method, order.items, actor, paid, 'Online', order.customer_id ?? undefined);
        this.run("UPDATE online_orders SET status = 'Confirmed', sale_id = ? WHERE id = ?", sale.id, key);
      } else {
        throw new BusinessError('This order cannot make the requested change.');
      }
      this.audit(actor, `online_order.${action}`, key);
      return { id: key };
    });
  }

  getPayments() {
    return this.all<Payment>(`SELECT p.*, EXISTS(SELECT 1 FROM money_reversals r
      JOIN money_transactions m ON m.id = r.transaction_id WHERE m.payment_id = p.id) AS reversed
      FROM payments p ORDER BY payment_date DESC`);
  }

  private recordPayment(input: PaymentInput, actor: string) {
    const sale = this.one<Sale>('SELECT * FROM sales WHERE id = ?', input.sale_id);
    if (!sale) throw new BusinessError('Sale was not found.');
    const payment = { ...input, id: id(), reference_number: input.reference_number || id(), payment_date: now() };
    if (this.one('SELECT id FROM payments WHERE reference_number = ?', payment.reference_number)) throw new BusinessError('This payment reference already exists.');
    if (input.status !== 'Paid' || input.method === 'Credit' || input.amount > this.saleBalance(sale.id)) {
      throw new BusinessError('Enter a completed payment within the remaining sale balance.');
    }
    const account = this.account(input.account ?? input.method);
    if (account.currency !== 'RWF' || account.kind !== input.method) throw new BusinessError('Choose a receiving account in RWF that matches the payment method.');
    this.run('INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?, ?)', payment.id, payment.sale_id,
      payment.reference_number, payment.amount, payment.method, payment.status, payment.payment_date, actor);
    this.run(`INSERT INTO money_transactions (id, kind, to_account, amount, reference, payment_id, actor_id, recorded_at)
      VALUES (?, 'customer_payment', ?, ?, ?, ?, ?, ?)`, id(), account.id, input.amount,
    `payment:${payment.reference_number}`, payment.id, actor, payment.payment_date);
    this.audit(actor, 'payment.recorded', payment.id);
    return payment;
  }

  createPayment(input: PaymentInput, actor: string) { return this.write(() => this.recordPayment(input, actor)); }

  private balance(account: string) {
    return this.one<{ balance: number }>(`SELECT COALESCE(SUM(
      CASE WHEN to_account = ? THEN COALESCE(destination_minor, amount)
        ELSE -COALESCE(source_minor, amount) - exchange_fee_minor END), 0) -
      (SELECT COALESCE(SUM(refund), 0) FROM sale_returns WHERE refund_account = ?) +
      (SELECT COALESCE(SUM(amount), 0) FROM active_shipment_resolutions WHERE action = 'cash' AND account_id = ?) AS balance
      FROM money_transactions m WHERE (to_account = ? OR from_account = ?)
        AND NOT EXISTS (SELECT 1 FROM money_reversals WHERE transaction_id = m.id)`, account, account, account, account, account)!.balance;
  }

  getFinance() {
    return {
      accounts: this.getAccountBalances(),
      transactions: this.all<{ id: string; kind: string; amount: number; reference: string; recorded_at: string; category: string | null; reversible: number;
        from_account: string | null; to_account: string | null; source_minor: number | null; destination_minor: number | null;
        currency: Currency | null; rate: number | null; fee: number; payable_amount: number | null; fx_difference: number }>(
        `SELECT m.id, CASE WHEN m.settlement_currency IS NOT NULL AND m.kind = 'transfer'
          AND a.currency <> b.currency THEN 'exchange' WHEN shipment_id IS NULL THEN m.kind ELSE 'shipment_payment' END AS kind,
        m.amount, reference, COALESCE(m.settled_at,m.recorded_at) AS recorded_at, category,
        CASE WHEN NOT EXISTS (SELECT 1 FROM money_reversals WHERE transaction_id = m.id) THEN 1 ELSE 0 END AS reversible,
        from_account, to_account, source_minor, destination_minor, settlement_currency AS currency, settlement_rate AS rate,
        exchange_fee_minor AS fee, payable_amount, fx_difference
        FROM money_transactions m LEFT JOIN accounts a ON a.id = m.from_account LEFT JOIN accounts b ON b.id = m.to_account
        UNION ALL SELECT id, 'refund', refund, 'return:' || reference, recorded_at, NULL, 0,
          refund_account, NULL, refund, NULL, 'RWF', 1000000, 0, NULL, 0 FROM sale_returns WHERE refund > 0
        UNION ALL SELECT r.id, CASE WHEN m.kind = 'expense' AND m.shipment_id IS NULL THEN 'expense_reversal' ELSE 'reversal' END,
          -m.amount, 'reversal:' || m.reference, r.recorded_at, r.reason, 0,
          m.to_account, m.from_account, m.destination_minor, m.source_minor, m.settlement_currency, m.settlement_rate,
          -m.exchange_fee_minor, -m.payable_amount, -m.fx_difference FROM money_reversals r
          JOIN money_transactions m ON m.id = r.transaction_id
        UNION ALL SELECT id, 'exchange_fee', exchange_fee_rwf, 'fee:' || reference, COALESCE(settled_at,recorded_at), NULL, 0,
          from_account,NULL,NULL,NULL,NULL,NULL,0,NULL,0 FROM money_transactions WHERE exchange_fee_rwf > 0
        UNION ALL SELECT r.id, 'expense_reversal', -m.exchange_fee_rwf, 'fee-reversal:' || m.reference,
          r.recorded_at, r.reason, 0,m.from_account,NULL,NULL,NULL,NULL,NULL,0,NULL,0
          FROM money_reversals r JOIN money_transactions m ON m.id = r.transaction_id WHERE m.exchange_fee_rwf > 0
        UNION ALL SELECT r.id, CASE WHEN r.action = 'reverse' THEN x.action || '_reversal' ELSE r.action END,
          CASE WHEN r.action = 'reverse' THEN -r.amount ELSE r.amount END, r.reference, r.recorded_at, r.notes, 0,
          NULL, r.account_id,NULL,NULL,'RWF',1000000,0,NULL,0
          FROM shipment_resolutions r LEFT JOIN shipment_resolutions x ON x.id = r.reverses_id
          WHERE r.action IN ('credit','cash','loss') OR x.action IN ('credit','cash','loss')
        ORDER BY recorded_at DESC, id DESC`),
    };
  }

  getAccounts() { return this.all<Account>('SELECT * FROM accounts ORDER BY name'); }
  getAccountBalances() { return this.getAccounts().map(row => ({ ...row, balance: this.balance(row.id) })); }

  getHistory(query: HistoryQuery): HistoryPage {
    const { from, order, params } = historySql(query);
    return transaction(this.db, () => {
      const total = this.one<{ total: number }>(`SELECT COUNT(*) AS total ${from}`, ...params)!.total;
      const pages = Math.max(1, Math.ceil(total / query.size));
      const page = Math.min(query.page, pages);
      const rows = this.all<HistoryRow>(`SELECT id,name,reference,status,recorded_at,amount,detail ${from}
        ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, query.size, (page - 1) * query.size);
      return { rows, total, pages, page, size: query.size };
    }, 'DEFERRED');
  }

  private account(key: string) {
    const row = this.one<Account>('SELECT * FROM accounts WHERE id = ? AND active = 1', key);
    if (!row) throw new BusinessError('Choose an active account.');
    return row;
  }

  createAccount(name: string, kind: string, actor: string, currency: Currency = 'RWF') {
    return this.write(() => {
      if (this.one('SELECT id FROM accounts WHERE name = ?', name)) throw new BusinessError('An account already uses that name.');
      const key = id();
      this.run('INSERT INTO accounts (id, name, kind, currency) VALUES (?, ?, ?, ?)', key, name, kind, currency);
      this.audit(actor, 'account.created', key);
      return { id: key };
    });
  }

  setAccountActive(key: string, active: boolean, actor: string) {
    return this.write(() => {
      if (!this.one('SELECT id FROM accounts WHERE id = ?', key)) throw new BusinessError('Account was not found.');
      this.run('UPDATE accounts SET active = ? WHERE id = ?', active ? 1 : 0, key);
      this.audit(actor, active ? 'account.enabled' : 'account.disabled', key);
      return { id: key };
    });
  }

  private supplierPaid(purchase: string) {
    return this.one<{ total: number }>(`SELECT COALESCE(SUM(COALESCE(payable_amount, amount)), 0) +
      (SELECT COALESCE(SUM(r.amount), 0) FROM active_shipment_resolutions r JOIN purchase_items i ON i.id = r.purchase_item_id
        WHERE r.action = 'credit' AND i.purchase_id = ?) AS total FROM money_transactions m
      WHERE purchase_id = ? AND kind = 'supplier_payment'
        AND NOT EXISTS (SELECT 1 FROM money_reversals WHERE transaction_id = m.id)`, purchase, purchase)!.total;
  }

  getDiscrepancies(shipment?: string) {
    const lines = this.all<{ event: string; item: string; shipment: string; shipment_reference: string; receipt: string;
      purchase: string; product: string; product_name: string; supplier: string; currency: Currency; rate_micros: number;
      ordered: number; expected: number; usable: number; damaged: number; missing: number; explanation: string; damaged_supplier_cost: number;
      allocated_expense: number; capitalized_expense: number; recorded_at: string }>(`
      SELECT r.event_id AS event, i.id AS item, s.id AS shipment, s.reference AS shipment_reference, e.reference AS receipt,
        p.id AS purchase, i.product_id AS product, g.name AS product_name, p.supplier_name AS supplier, p.currency, p.rate_micros,
        i.quantity AS ordered, plan.expected, r.usable, r.damaged, r.missing, r.explanation, r.damaged_supplier_cost,
        r.allocated_expense, r.capitalized_expense, e.recorded_at
      FROM shipment_receiving_lines r JOIN shipment_receiving_events e ON e.id = r.event_id
      JOIN shipments s ON s.id = e.shipment_id JOIN purchase_items i ON i.id = r.purchase_item_id
      JOIN shipment_manifest_lines plan ON plan.shipment_id = r.shipment_id AND plan.purchase_item_id = r.purchase_item_id
      JOIN purchases p ON p.id = i.purchase_id JOIN products g ON g.id = i.product_id
      WHERE (r.damaged > 0 OR r.missing > 0) AND (CAST(? AS TEXT) IS NULL OR s.id = ?)
      ORDER BY e.recorded_at DESC, r.event_id, r.purchase_item_id`, shipment ?? null, shipment ?? null);
    return lines.flatMap(line => {
      const freight = line.allocated_expense - line.capitalized_expense;
      const damageFreight = roundedShare(freight, line.damaged, line.damaged + line.missing);
      return (['damage', 'shortage'] as const).filter(kind => kind === 'damage' ? line.damaged : line.missing).map(kind => {
        const exposure = kind === 'damage' ? line.damaged_supplier_cost + damageFreight : freight - damageFreight;
        const events = this.all<{ id: string; action: string; amount: number; quantity: number; reference: string; notes: string;
          recorded_at: string; active: number }>(`SELECT r.*, EXISTS(SELECT 1 FROM active_shipment_resolutions a WHERE a.id = r.id) AS active
          FROM shipment_resolutions r WHERE event_id = ? AND purchase_item_id = ? AND kind = ? ORDER BY recorded_at, rowid`,
        line.event, line.item, kind);
        const active = events.filter(row => row.active);
        const held = kind === 'damage' ? line.damaged - sum(active, row => row.quantity) : 0;
        const remaining = Math.max(0, exposure - sum(active, row => row.amount));
        const available = this.one<{ available: number; subtotal: number; quantity: number; processed: number }>(
          `SELECT quantity - received_quantity - damaged_quantity - closed_quantity - reserved_quantity AS available, subtotal, quantity,
            received_quantity + damaged_quantity + closed_quantity AS processed FROM purchase_receiving_status WHERE id = ?`, line.item)!;
        const missingCost = kind === 'shortage' && line.missing <= available.available
          ? roundedShare(available.subtotal, available.processed + line.missing, available.quantity)
            - roundedShare(available.subtotal, available.processed, available.quantity) : null;
        const claim = this.one<{ id: string; reference: string; claimant: string; claimed_rwf: number; accepted_rwf: number | null }>(
          'SELECT * FROM shipment_claims WHERE event_id = ? AND purchase_item_id = ? AND kind = ?', line.event, line.item, kind);
        return { ...line, kind, exposure, held, remaining, claim, events, missingCost,
          remainingWithClosure: missingCost === null ? null : Math.max(0, exposure + missingCost - sum(active, row => row.amount)) };
      });
    });
  }

  resolveDiscrepancy(input: ClaimCommand, actor: string) {
    return this.write(() => {
      const result = id();
      if (input.action === 'decide') {
        const claim = this.one<{ claimed_rwf: number; accepted_rwf: number | null }>('SELECT * FROM shipment_claims WHERE id = ?', input.claim);
        if (!claim || claim.accepted_rwf !== null || input.accepted > claim.claimed_rwf) throw new BusinessError('Choose a pending claim and an amount within its reported value.');
        this.run('UPDATE shipment_claims SET accepted_rwf = ?, decision_actor = ?, decided_at = ? WHERE id = ?', input.accepted, actor, now(), input.claim);
        this.audit(actor, `shipment.claim_decision: ${input.notes}`, input.claim);
        return { id: input.claim };
      }
      if (input.action === 'reverse') {
        const source = this.one<Discrepancy & { action: string; amount: number; account_id: string | null; purchase_closed_quantity: number; recorded_at: string }>(
          'SELECT *, event_id AS event, purchase_item_id AS item FROM active_shipment_resolutions WHERE id = ?', input.resolution);
        if (!source || !['credit', 'cash', 'loss'].includes(source.action)) throw new BusinessError('Choose an active financial resolution.');
        if (source.purchase_closed_quantity && this.one(`SELECT 1 FROM stock_movements WHERE purchase_item_id = ? AND movement_date >= ?
          UNION ALL SELECT 1 FROM shipment_receiving_lines r JOIN shipment_receiving_events e ON e.id = r.event_id
          WHERE r.purchase_item_id = ? AND e.recorded_at >= ? LIMIT 1`, source.item, source.recorded_at, source.item, source.recorded_at)) {
          throw new BusinessError('Later receipts rely on this purchase quantity closure. A separate correction is required.');
        }
        if (source.action !== 'loss' && this.one(`SELECT 1 FROM active_shipment_resolutions
          WHERE event_id = ? AND purchase_item_id = ? AND kind = ? AND action IN ('loss','recover')`, source.event, source.item, source.kind)) {
          throw new BusinessError('Reverse any dependent loss before undoing compensation. A posted recovery requires a separate stock correction.');
        }
        if (source.account_id && this.balance(source.account_id) < source.amount) throw new BusinessError('Insufficient funds to reverse compensation.');
        if (this.one("SELECT 1 FROM shipment_resolutions WHERE reference = ?", input.reference)) throw new BusinessError('Resolution reference already exists.');
        this.run(`INSERT INTO shipment_resolutions
          (id,event_id,purchase_item_id,kind,action,reference,notes,amount,quantity,reverses_id,actor_id,recorded_at)
          VALUES (?,?,?,?,'reverse',?,?,?,0,?,?,?)`, result, source.event, source.item, source.kind, input.reference, input.notes,
          source.amount, input.resolution, actor, now());
        this.audit(actor, 'shipment.resolution_reversed', result);
        return { id: result };
      }
      const row = this.getDiscrepancies().find(row => row.event === input.event && row.item === input.item && row.kind === input.kind);
      if (!row) throw new BusinessError('Choose a shipment discrepancy.');
      if (row.events.some(event => event.active && event.action === 'loss')) throw new BusinessError('Reverse the loss before changing this case.');
      if (input.action === 'claim') {
        const amount = reportingValue(input.amount, input.currency, input.rate);
        if (row.claim || amount < 1 || this.one('SELECT 1 FROM shipment_claims WHERE reference = ?', input.reference)) {
          throw new BusinessError('Use a new reference and a positive claim value for an unclaimed discrepancy.');
        }
        this.run(`INSERT INTO shipment_claims (id,event_id,purchase_item_id,kind,reference,claimant,notes,currency,claimed,rate_micros,
          claimed_rwf,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, result, row.event, row.item, row.kind, input.reference,
          input.claimant, input.notes, input.currency, input.amount, input.rate, amount, actor, now());
        this.audit(actor, 'shipment.claim_submitted', result);
        return { id: result };
      }
      if (this.one("SELECT 1 FROM shipment_resolutions WHERE reference = ?", input.reference)) throw new BusinessError('Resolution reference already exists.');
      let amount = 0;
      let quantity = 0;
      let account: string | null = null;
      let movement: string | null = null;
      let payableMinor: number | null = null;
      let closedQuantity = 0;
      if (input.action === 'credit' || input.action === 'cash') {
        if (!row.claim?.accepted_rwf || row.events.some(event => event.active && ['credit','cash'].includes(event.action))) {
          throw new BusinessError('Accept the claim before posting one settlement.');
        }
        amount = row.claim.accepted_rwf;
        if (input.action === 'credit') {
          const purchase = this.one<Purchase>('SELECT * FROM purchases WHERE id = ?', row.purchase)!;
          const outstanding = purchase.total_amount - this.supplierPaid(purchase.id);
          if (purchase.currency && purchase.currency !== 'RWF') {
            payableMinor = input.payable_minor ?? 0;
            amount = this.foreignPayableRelease(purchase, outstanding, payableMinor);
            if (amount > row.claim.accepted_rwf) throw new BusinessError('The historical credit value exceeds the accepted claim amount.');
          }
          if (amount > outstanding) throw new BusinessError('Credit exceeds the eligible purchase payable.');
        } else {
          account = input.account ?? null;
          if (!account || this.account(account).currency !== 'RWF') throw new BusinessError('Choose the active RWF account that received the verified compensation.');
        }
      } else if (input.action === 'recover' || input.action === 'return') {
        quantity = input.quantity ?? 0;
        if (quantity < 1 || quantity > row.held) throw new BusinessError('Enter a quantity within the damaged goods held.');
        if (input.action === 'recover') {
          const consumed = row.damaged - row.held;
          amount = Math.min(row.remaining, roundedShare(row.exposure, consumed + quantity, row.damaged)
            - roundedShare(row.exposure, consumed, row.damaged));
          movement = this.adjust(this.product(row.product), quantity, `Shipment recovery: ${input.notes}`, actor, undefined, undefined, amount).id;
        }
      } else {
        if (row.claim?.accepted_rwf === null || (row.claim?.accepted_rwf && !row.events.some(event => event.active && ['credit','cash'].includes(event.action)))) {
          throw new BusinessError('Resolve and settle the claim first.');
        }
        amount = row.remaining;
        quantity = row.held;
        if (input.close_missing) {
          if (row.kind !== 'shortage' || row.remainingWithClosure === null) throw new BusinessError('These missing units are no longer unreserved.');
          amount = row.remainingWithClosure;
          closedQuantity = row.missing;
        }
      }
      this.run(`INSERT INTO shipment_resolutions
        (id,event_id,purchase_item_id,kind,action,reference,notes,amount,quantity,account_id,claim_id,movement_id,actor_id,recorded_at,payable_minor,purchase_closed_quantity)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, result, row.event, row.item, row.kind, input.action,
      input.reference, input.notes, amount, quantity, account, row.claim?.id ?? null, movement, actor, now(), payableMinor, closedQuantity);
      this.audit(actor, `shipment.${input.action}`, result);
      return { id: result };
    });
  }

  private foreignPayableRelease(purchase: Purchase, outstanding: number, minor: number) {
    const original = this.one<{ total: number }>('SELECT COALESCE(SUM(quantity * original_unit_minor),0) AS total FROM purchase_items WHERE purchase_id = ?', purchase.id)!.total;
    const credit = this.one<{ total: number }>(`SELECT COALESCE(SUM(r.payable_minor),0) AS total
      FROM active_shipment_resolutions r JOIN purchase_items i ON i.id = r.purchase_item_id
      WHERE i.purchase_id = ? AND r.action = 'credit'`, purchase.id)!.total;
    const paid = this.one<{ native: number; legacy: number }>(`SELECT COALESCE(SUM(payable_minor),0) AS native,
      COALESCE(SUM(CASE WHEN payable_minor IS NULL THEN COALESCE(payable_amount,amount) ELSE 0 END),0) AS legacy
      FROM money_transactions m WHERE purchase_id = ? AND kind = 'supplier_payment'
      AND NOT EXISTS (SELECT 1 FROM money_reversals WHERE transaction_id = m.id)`, purchase.id)!;
    const remaining = original - credit - paid.native - roundedShare(original, paid.legacy, Math.max(1, purchase.total_amount));
    if (minor <= 0 || minor > remaining || outstanding <= 0) throw new BusinessError('Enter the original-currency amount discharged within the remaining purchase obligation.');
    const applied = minor === remaining ? outstanding : Math.min(outstanding - 1, roundedShare(outstanding, minor, remaining));
    if (!applied) throw new BusinessError('This partial settlement rounds to zero RWF.');
    return applied;
  }

  reverseFinance(key: string, reason: string, actor: string) {
    return this.write(() => {
      const source = this.one<{ to_account: string | null; amount: number; payment_id: string | null; destination_minor: number | null }>(
        `SELECT m.* FROM money_transactions m WHERE id = ? AND NOT EXISTS
          (SELECT 1 FROM money_reversals WHERE transaction_id = m.id)`, key);
      if (!source) throw new BusinessError('Choose an unreversed transaction.');
      if (source.to_account && this.balance(source.to_account) < (source.destination_minor ?? source.amount)) throw new BusinessError('Insufficient funds to reverse this transaction.');
      if (source.payment_id) {
        const payment = this.one<Payment>('SELECT * FROM payments WHERE id = ?', source.payment_id)!;
        const receipt = this.getSaleReceipt(payment.sale_id)!;
        if (receipt.total_amount - receipt.returned - receipt.balance < source.amount) {
          throw new BusinessError('A refund already used part of this payment.');
        }
      }
      const reversal = id();
      this.run('INSERT INTO money_reversals VALUES (?, ?, ?, ?, ?)', reversal, key, reason, actor, now());
      this.audit(actor, 'finance.reversed', reversal);
      return { id: reversal };
    });
  }

  recordFinance(entry: FinanceEntry, actor: string, attachment?: ExpenseReceiptUpload) {
    return this.write(() => {
      const key = id();
      const reference = `manual:${entry.reference}`;
      const existing = this.one<{ id: string; actor_id: string; expense_request: string | null }>(
        'SELECT id,actor_id,expense_request FROM money_transactions WHERE reference=?', reference);
      if (existing) {
        if (entry.expense_request && existing.expense_request === entry.expense_request && existing.actor_id === actor) {
          if (attachment) this.insertExpenseReceipt(existing.id, attachment, actor);
          return { id: existing.id };
        }
        throw new BusinessError('This transaction reference already exists.');
      }
      const from = entry.kind === 'opening' ? null : entry.account;
      const to = entry.kind === 'opening' ? entry.account : entry.destination ?? null;
      const account = this.account(entry.account);
      const destination = to ? this.account(to) : null;
      const rate = entry.rate ?? (account.currency === 'RWF' ? 1000000 : 0);
      if (entry.settled_on && entry.settled_on > date(new Date())) throw new BusinessError('Choose a settlement date on or before today in Kigali.');
      if (rate <= 0 || (account.currency === 'RWF' && rate !== 1000000)) throw new BusinessError('Enter the actual settlement rate for the source currency.');
      if (['transfer','exchange'].includes(entry.kind) && (!destination || from === to)) throw new BusinessError('Choose a different destination account.');
      if (entry.kind === 'transfer' && destination?.currency !== account.currency) throw new BusinessError('Use an exchange for accounts with different currencies.');
      if (entry.kind === 'exchange' && (destination?.currency === account.currency || !entry.received)) throw new BusinessError('Enter the actual amount received in a different currency.');
      const fee = entry.kind === 'exchange' ? entry.fee ?? 0 : 0;
      if (from && this.balance(from) < entry.amount + fee) throw new BusinessError('Insufficient account balance.');
      const reporting = reportingValue(entry.amount, account.currency, rate);
      if (reporting < 1) throw new BusinessError('The reporting value must be at least one RWF.');
      let applied: number | null = null;
      let payableMinor: number | null = null;
      if (entry.kind === 'supplier_payment') {
        const purchase = this.one<Purchase>('SELECT * FROM purchases WHERE id = ?', entry.purchase ?? '');
        if (!purchase) throw new BusinessError('Choose a purchase.');
        const outstanding = purchase.total_amount - this.supplierPaid(purchase.id);
        applied = reporting;
        if (purchase.currency && purchase.currency !== 'RWF') {
          payableMinor = entry.payable_minor ?? (account.currency === purchase.currency ? entry.amount : 0);
          if (account.currency === purchase.currency && payableMinor !== entry.amount) throw new BusinessError('Discharged units must match the native payment.');
          applied = this.foreignPayableRelease(purchase, outstanding, payableMinor);
        }
        if (applied > outstanding || outstanding <= 0) {
          throw new BusinessError('Enter a payment within the purchase balance.');
        }
      }
      if (entry.kind === 'shipment_payment') {
        const shipment = this.getShipments().find(row => row.id === entry.shipment);
        if (!shipment || reporting > shipment.expenses - shipment.paid) {
          throw new BusinessError('Enter a payment within the shipment expense balance.');
        }
      }
      const kind = entry.kind === 'shipment_payment' ? 'expense' : entry.kind === 'exchange' ? 'transfer' : entry.kind;
      this.run(`INSERT INTO money_transactions
        (id, kind, from_account, to_account, amount, reference, category, purchase_id, actor_id, recorded_at, shipment_id,
          source_minor,destination_minor,settlement_currency,settlement_rate,exchange_fee_minor,exchange_fee_rwf,payable_amount,payable_minor,fx_difference,settled_at,
          expense_details,expense_request)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, key, kind, from, to, reporting, reference,
      entry.category ?? null, entry.purchase ?? null, actor, now(), entry.shipment ?? null,
      from ? entry.amount : null, to ? entry.received ?? entry.amount : null, account.currency, rate,
      fee, reportingValue(fee, account.currency, rate), applied, payableMinor, applied === null ? 0 : reporting - applied,
      entry.settled_on ? new Date(`${entry.settled_on}T00:00:00+02:00`).toISOString() : null,
      entry.expense_details ?? null, entry.expense_request ?? null);
      this.audit(actor, 'finance.recorded', key);
      if (attachment) this.insertExpenseReceipt(key, attachment, actor);
      return { id: key };
    });
  }

  recordExpense(raw: ExpenseInput, actor: string, attachment?: ExpenseReceiptUpload) {
    const input = expenseInput.parse(raw);
    const { description, payee, receipt, related } = input;
    return this.recordFinance({ ...input, kind: 'expense', reference: `expense-${input.request_key}`,
      expense_details: JSON.stringify({ description, payee, receipt, related }), expense_request: JSON.stringify(input) }, actor, attachment);
  }

  private insertExpenseReceipt(expense: string, raw: ExpenseReceiptUpload, actor: string) {
    const attachment = expenseReceiptUpload(raw.filename, raw.contentType, raw.contents);
    if (!attachment) throw new BusinessError('Choose a supported receipt file up to 2 MiB.');
    if (!this.one("SELECT id FROM money_transactions WHERE id=? AND kind='expense' AND shipment_id IS NULL", expense)) {
      throw new BusinessError('Select an operating expense for this receipt.');
    }
    const digest = createHash('sha256').update(attachment.contents).digest('hex');
    const existing = this.one<{ id: string }>('SELECT id FROM expense_receipts WHERE expense_id=? AND digest=?', expense, digest);
    if (existing) return existing;
    const receipt = id();
    this.run('INSERT INTO expense_receipts VALUES (?,?,?,?,?,?,?,?)', receipt, expense, attachment.filename,
      attachment.contentType, attachment.contents, digest, actor, now());
    this.audit(actor, 'expense.receipt_attached', receipt);
    return { id: receipt };
  }

  attachExpenseReceipt(expense: string, attachment: ExpenseReceiptUpload, actor: string) {
    return this.write(() => this.insertExpenseReceipt(expense, attachment, actor));
  }

  getExpenseReceipt(expense: string, receipt: string) {
    return this.one<{ filename: string; content_type: string; contents: Uint8Array }>(
      'SELECT filename,content_type,contents FROM expense_receipts WHERE expense_id=? AND id=?', expense, receipt);
  }

  getExpenses(filters: ExpenseFilters, allRows = false) {
    return transaction(this.db, () => {
      const clauses: string[] = [];
      const params: SQLInputValue[] = [];
      for (const [column, value] of [['category', filters.category], ['account_id', filters.account]]) {
        if (value) { clauses.push(`e.${column} = ?`); params.push(value); }
      }
      if (filters.start) { clauses.push("date(e.effective_at, '+2 hours') >= ?"); params.push(filters.start); }
      if (filters.end) { clauses.push("date(e.effective_at, '+2 hours') <= ?"); params.push(filters.end); }
      if (filters.q) {
        clauses.push("instr(lower(e.category || ' ' || coalesce(e.expense_details,'') || ' ' || e.reference || ' ' || coalesce(a.name,'')), lower(?)) > 0");
        params.push(filters.q);
      }
      const from = `FROM operating_expense_entries e LEFT JOIN accounts a ON a.id=e.account_id
        JOIN users u ON u.id=e.actor_id ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`;
      const totals = this.one<{ count: number; amount: number }>(`SELECT COUNT(*) AS count,COALESCE(SUM(e.amount),0) AS amount ${from}`, ...params)!;
      const groups = this.all<{ category: string; amount: number }>(`SELECT e.category,SUM(e.amount) AS amount ${from}
        GROUP BY e.category ORDER BY amount DESC,e.category`, ...params);
      const pages = Math.max(1, Math.ceil(totals.count / filters.size));
      const page = Math.min(filters.page, pages);
      const order = filters.sort === 'oldest' || filters.sort === 'asc' ? 'e.effective_at ASC' :
        filters.sort === 'amount' ? 'e.amount DESC' : 'e.effective_at DESC';
      const rows = this.all<{ id: string; reference: string; category: string; effective_at: string; status: string; amount: number;
        native_amount: number; currency: Currency; account: string | null; actor: string; expense_details: string | null; reversal_reason: string | null;
        source_kind: string }>(
        `SELECT e.*, a.name AS account,u.name AS actor ${from} ORDER BY ${order}, e.id ${allRows ? '' : 'LIMIT ? OFFSET ?'}`,
        ...params, ...(allRows ? [] : [filters.size, (page - 1) * filters.size]));
      return { totals, groups, page, pages, rows: rows.map(row => {
        const { expense_details, ...rest } = row;
        return { ...rest, details: expense_details ? JSON.parse(expense_details) as Pick<ExpenseInput, 'description' | 'payee' | 'receipt' | 'related'> : null,
          attachments: allRows || row.source_kind !== 'expense' || row.status === 'Reversal' ? [] :
            this.all<{ id: string; filename: string }>('SELECT id,filename FROM expense_receipts WHERE expense_id=? ORDER BY created_at,id',row.id) };
      }), today: this.operatingExpenses(date(new Date())), month: this.operatingExpenses(date(new Date()).slice(0, 7)),
      recentCategories: this.all<{ category: string }>(`SELECT category FROM operating_expense_entries WHERE status='Posted'
        GROUP BY category ORDER BY MAX(effective_at) DESC,category LIMIT 5`).map(row => row.category),
      categories: this.all<{ category: string }>('SELECT DISTINCT category FROM operating_expense_entries ORDER BY category').map(row => row.category),
      balances: allRows ? [] : this.getAccountBalances() };
    }, 'DEFERRED');
  }

  private operatingExpenses(period: string) {
    return this.one<{ total: number }>(`SELECT COALESCE(SUM(amount),0) AS total FROM operating_expense_entries
      WHERE date(effective_at,'+2 hours') LIKE ?`, period + '%')!.total;
  }

  getDashboardStats() {
    const products = this.getProducts();
    const today = date(new Date());
    const allSales = this.getSales();
    const sales = allSales.filter(sale => date(sale.sale_date) === today);
    const returns = this.getReturns();
    const todaysReturns = returns.filter(row => date(row.recorded_at) === today);
    const grossProfit = sum(sales, sale => sale.total_amount - sum(sale.items, item => item.cost)) -
      sum(todaysReturns, row => row.revenue_credit - row.cost_credit);
    const expenses = this.operatingExpenses(today);
    return {
      total_products: products.length, total_stock: sum(products, product => product.quantity),
      total_sales_today: sales.length, total_revenue: sum(sales, sale => sale.total_amount) - sum(todaysReturns, row => row.revenue_credit),
      total_expenses: expenses,
      total_profit: grossProfit - expenses,
      inventory_value: sum(products, product => product.stock_value ?? 0),
      monthly_sales: sum(allSales.filter(sale => date(sale.sale_date).startsWith(today.slice(0, 7))), sale => sale.total_amount) -
        sum(returns.filter(row => date(row.recorded_at).startsWith(today.slice(0, 7))), row => row.revenue_credit),
      monthly_expenses: this.operatingExpenses(today.slice(0, 7)),
      supplier_balance: sum(this.getPurchases(), purchase => purchase.balance),
      customer_balance: sum(allSales, sale => sale.balance),
      available_funds: sum(this.getAccountBalances().filter(account => account.currency === 'RWF'), account => account.balance),
      pending_shipments: this.one<{ total: number }>("SELECT COUNT(*) AS total FROM shipments WHERE status <> 'Received'")!.total,
      unresolved_shipments: this.getDiscrepancies().filter(row => !row.events.some(event => event.active && event.action === 'loss') &&
        (row.held > 0 || row.remaining > 0 || !row.events.some(event => event.active && ['cash','credit','recover','return'].includes(event.action)))).length,
      gross_profit_today: grossProfit,
      low_stock_items: products.filter(product => product.quantity <= product.minimum_quantity),
    };
  }

  getReports(period: { start?: string; end?: string } = {}) {
    const today = date(new Date());
    const month = today.slice(0, 7);
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const weekStart = monday.toISOString().slice(0, 10);
    const matches = businessPeriod(period, month);
    const sales = this.getSales();
    const names = new Map(this.all<Product>('SELECT * FROM products').map(product => [product.id, product.name]));
    const daily = sales.filter(sale => date(sale.sale_date) === today);
    const monthly = sales.filter(sale => matches(sale.sale_date));
    const returns = this.getReturns();
    const dailyReturns = returns.filter(row => date(row.recorded_at) === today);
    const periodReturns = returns.filter(row => matches(row.recorded_at));
    const weekly = sales.filter(sale => date(sale.sale_date) >= weekStart && date(sale.sale_date) <= today);
    const weeklyReturns = returns.filter(row => date(row.recorded_at) >= weekStart && date(row.recorded_at) <= today);
    const byProduct = new Map<string, { product: string; units: number; revenue: number }>();
    const channels = new Map<string, number>();
    for (const sale of monthly) {
      const channel = sale.channel ?? 'Physical shop';
      channels.set(channel, (channels.get(channel) ?? 0) + sale.total_amount);
    }
    for (const item of monthly.flatMap(sale => sale.items)) {
      const row = byProduct.get(item.product_id) ?? { product: names.get(item.product_id) ?? item.product_id, units: 0, revenue: 0 };
      row.units += item.quantity;
      row.revenue += item.subtotal;
      byProduct.set(item.product_id, row);
    }
    for (const item of periodReturns) {
      const row = byProduct.get(item.product_id) ?? { product: item.name, units: 0, revenue: 0 };
      row.units -= item.quantity;
      row.revenue -= item.revenue_credit;
      byProduct.set(item.product_id, row);
      channels.set(item.channel, (channels.get(item.channel) ?? 0) - item.revenue_credit);
    }
    const profit = (rows: typeof sales, credits: typeof returns) => sum(rows, sale => sale.total_amount - sum(sale.items, item => item.cost)) -
      sum(credits, row => row.revenue_credit - row.cost_credit);
    const finance = this.getFinance().transactions.filter(row => matches(row.recorded_at));
    return {
      weekly: { start: weekStart, revenue: sum(weekly, row => row.total_amount) - sum(weeklyReturns, row => row.revenue_credit),
        profit: profit(weekly, weeklyReturns) },
      daily: { products_sold: sum(daily.flatMap(sale => sale.items), item => item.quantity) - sum(dailyReturns, row => row.quantity),
        revenue: sum(daily, sale => sale.total_amount) - sum(dailyReturns, row => row.revenue_credit), expenses: this.operatingExpenses(today), profit: profit(daily, dailyReturns) },
      monthly: { best_selling_products: [...byProduct.values()].sort((a, b) => b.units - a.units),
        revenue: sum(monthly, sale => sale.total_amount) - sum(periodReturns, row => row.revenue_credit), profit: profit(monthly, periodReturns),
        expenses: sum(finance.filter(row => ['expense', 'expense_reversal', 'exchange_fee'].includes(row.kind)), row => row.amount),
        shipment_losses: sum(finance.filter(row => ['loss', 'loss_reversal'].includes(row.kind)), row => row.amount),
        fx_difference: sum(finance, row => row.fx_difference),
        channels: Array.from(channels, ([channel, revenue]) => ({ channel, revenue })),
        purchases: sum(this.getPurchases().filter(purchase => matches(purchase.purchase_date)), purchase => purchase.total_amount),
        remaining_stock: sum(this.getProducts(), product => product.quantity) },
    };
  }
}

let database: BusinessDatabase | undefined;
export const dataStore = new DataStore(() => database ??= connectBusinessDatabase());
