export const migrations = [{
  version: 1,
  sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE products (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
      selling_price INTEGER NOT NULL CHECK (selling_price >= 0),
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      minimum_quantity INTEGER NOT NULL CHECK (minimum_quantity >= 0),
      supplier TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT
    ) STRICT;
    CREATE TABLE purchases (
      id TEXT PRIMARY KEY, supplier_name TEXT NOT NULL,
      total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
      purchase_date TEXT NOT NULL, created_at TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id)
    ) STRICT;
    CREATE TABLE purchase_items (
      id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id),
      product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0), subtotal INTEGER NOT NULL CHECK (subtotal >= 0)
    ) STRICT;
    CREATE TABLE sales (
      id TEXT PRIMARY KEY, customer_name TEXT, total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
      payment_method TEXT NOT NULL, sale_date TEXT NOT NULL, created_at TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id)
    ) STRICT;
    CREATE TABLE sale_items (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
      product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK (quantity > 0),
      selling_price INTEGER NOT NULL CHECK (selling_price >= 0),
      subtotal INTEGER NOT NULL CHECK (subtotal >= 0), cost INTEGER NOT NULL CHECK (cost >= 0)
    ) STRICT;
    CREATE TABLE payments (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
      reference_number TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL CHECK (amount > 0),
      method TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('Paid', 'Pending', 'Failed')),
      payment_date TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id)
    ) STRICT;
    CREATE TABLE stock_movements (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('Stock In', 'Stock Out')),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      movement_date TEXT NOT NULL, remaining_stock INTEGER NOT NULL CHECK (remaining_stock >= 0),
      reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
      purchase_item_id TEXT REFERENCES purchase_items(id), sale_item_id TEXT REFERENCES sale_items(id)
    ) STRICT;
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
      entity_id TEXT NOT NULL, recorded_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX purchase_items_purchase ON purchase_items(purchase_id);
    CREATE INDEX sale_items_sale ON sale_items(sale_id);
    CREATE INDEX payments_sale ON payments(sale_id);
    CREATE INDEX stock_movements_product ON stock_movements(product_id, movement_date);
    CREATE INDEX stock_movements_receipt ON stock_movements(purchase_item_id);
    CREATE INDEX sales_date ON sales(sale_date);
    CREATE INDEX purchases_date ON purchases(purchase_date);
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE products ADD COLUMN stock_value INTEGER NOT NULL DEFAULT 0 CHECK (stock_value >= 0);
    UPDATE products SET stock_value = quantity * purchase_price;
    ALTER TABLE purchases ADD COLUMN currency TEXT NOT NULL DEFAULT 'RWF' CHECK (currency IN ('RWF', 'CNY', 'USD'));
    ALTER TABLE purchases ADD COLUMN rate_micros INTEGER NOT NULL DEFAULT 1000000 CHECK (rate_micros > 0);
    ALTER TABLE purchases ADD COLUMN invoice_reference TEXT NOT NULL DEFAULT '';
    ALTER TABLE purchase_items ADD COLUMN original_unit_minor INTEGER CHECK (original_unit_minor >= 0);
    CREATE TABLE shipments (
      id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, agent TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Planned', 'In transit', 'Received')),
      created_at TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id)
    ) STRICT;
    CREATE TABLE shipment_expenses (
      shipment_id TEXT NOT NULL REFERENCES shipments(id), kind TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0), PRIMARY KEY (shipment_id, kind)
    ) STRICT;
    CREATE TABLE shipment_receipt_items (
      shipment_id TEXT NOT NULL REFERENCES shipments(id),
      purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id),
      movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id),
      supplier_cost INTEGER NOT NULL CHECK (supplier_cost >= 0),
      allocated_expense INTEGER NOT NULL CHECK (allocated_expense >= 0),
      PRIMARY KEY (shipment_id, purchase_item_id)
    ) STRICT;
  `,
}, {
  version: 3,
  sql: `
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kind TEXT NOT NULL CHECK (kind IN ('Cash', 'Mobile Money', 'Bank Transfer'))
    ) STRICT;
    INSERT INTO accounts VALUES ('Cash', 'Cash', 'Cash'), ('Mobile Money', 'Mobile Money', 'Mobile Money'),
      ('Bank Transfer', 'Bank', 'Bank Transfer');
    CREATE TABLE money_transactions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('customer_payment', 'supplier_payment', 'expense', 'transfer', 'opening')),
      from_account TEXT REFERENCES accounts(id), to_account TEXT REFERENCES accounts(id),
      amount INTEGER NOT NULL CHECK (amount > 0), reference TEXT NOT NULL UNIQUE, category TEXT,
      payment_id TEXT UNIQUE REFERENCES payments(id), purchase_id TEXT REFERENCES purchases(id),
      actor_id TEXT NOT NULL REFERENCES users(id), recorded_at TEXT NOT NULL,
      CHECK (from_account IS NOT NULL OR to_account IS NOT NULL),
      CHECK (from_account IS NULL OR to_account IS NULL OR from_account <> to_account)
    ) STRICT;
    CREATE INDEX money_by_date ON money_transactions(recorded_at);
    CREATE INDEX money_by_purchase ON money_transactions(purchase_id);
    INSERT INTO money_transactions (id, kind, to_account, amount, reference, payment_id, actor_id, recorded_at)
      SELECT id, 'customer_payment', method, amount, 'payment:' || reference_number, id, actor_id, payment_date
      FROM payments WHERE status = 'Paid';
  `,
}, {
  version: 4,
  sql: `
    ALTER TABLE sales ADD COLUMN channel TEXT NOT NULL DEFAULT 'Physical shop';
    CREATE TABLE online_orders (
      id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, contact TEXT NOT NULL, source TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'Pending' CHECK (delivery_status IN ('Pending', 'Ready', 'Delivered', 'Collected')),
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Cancelled')),
      sale_id TEXT UNIQUE REFERENCES sales(id), actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE online_order_items (
      order_id TEXT NOT NULL REFERENCES online_orders(id), product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0), price INTEGER NOT NULL CHECK (price >= 0),
      PRIMARY KEY (order_id, product_id)
    ) STRICT;
  `,
}, {
  version: 5,
  sql: `
    ALTER TABLE sales ADD COLUMN request_key TEXT;
    CREATE UNIQUE INDEX sales_request_key ON sales(request_key) WHERE request_key IS NOT NULL;
    ALTER TABLE stock_movements ADD COLUMN receipt_reference TEXT;
    CREATE UNIQUE INDEX stock_receipt_reference ON stock_movements(receipt_reference) WHERE receipt_reference IS NOT NULL;
  `,
}, {
  version: 6,
  sql: `
    CREATE TABLE stock_counts (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
      expected INTEGER NOT NULL CHECK (expected >= 0), counted INTEGER NOT NULL CHECK (counted >= 0),
      reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
      movement_id TEXT UNIQUE REFERENCES stock_movements(id), recorded_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX counts_by_product ON stock_counts(product_id, recorded_at);
  `,
}, {
  version: 7,
  sql: `
    CREATE TABLE sale_returns (
      id TEXT PRIMARY KEY, sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0), reason TEXT NOT NULL, recorded_at TEXT NOT NULL,
      revenue_credit INTEGER NOT NULL CHECK (revenue_credit >= 0),
      cost_credit INTEGER NOT NULL CHECK (cost_credit >= 0),
      refund INTEGER NOT NULL CHECK (refund >= 0), refund_account TEXT REFERENCES accounts(id),
      movement_id TEXT UNIQUE REFERENCES stock_movements(id), actor_id TEXT NOT NULL REFERENCES users(id),
      reference TEXT NOT NULL UNIQUE,
      CHECK ((refund > 0) = (refund_account IS NOT NULL))
    ) STRICT;
    CREATE INDEX returns_by_item ON sale_returns(sale_item_id);
    CREATE INDEX returns_by_date ON sale_returns(recorded_at);
  `,
}, {
  version: 8,
  sql: `
    CREATE TABLE business_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, address TEXT NOT NULL,
      phone TEXT NOT NULL, receipt_footer TEXT NOT NULL
    ) STRICT;
    INSERT INTO business_settings VALUES (1, 'BizFlow Jewelry', '', '', '');
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('Customer', 'Supplier', 'Agent')),
      name TEXT NOT NULL COLLATE NOCASE, phone TEXT NOT NULL, email TEXT NOT NULL,
      location TEXT NOT NULL, UNIQUE(kind, name)
    ) STRICT;
  `,
}, {
  version: 9,
  sql: `
    CREATE TABLE product_images (
      product_id TEXT PRIMARY KEY REFERENCES products(id),
      content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
      contents BLOB NOT NULL CHECK (length(contents) BETWEEN 1 AND 2097152)
    ) STRICT;
  `,
}, {
  version: 10,
  sql: `
    ALTER TABLE money_transactions ADD COLUMN shipment_id TEXT REFERENCES shipments(id);
    CREATE INDEX money_by_shipment ON money_transactions(shipment_id);
  `,
}, {
  version: 11,
  sql: `
    ALTER TABLE stock_movements ADD COLUMN disposition TEXT CHECK (disposition IN ('Damaged', 'Missing'));
  `,
}, {
  version: 12,
  sql: `
    CREATE TABLE money_reversals (
      id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE REFERENCES money_transactions(id),
      reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), recorded_at TEXT NOT NULL
    ) STRICT;
  `,
}, {
  version: 13,
  sql: `
    CREATE TABLE shipment_manifests (
      shipment_id TEXT PRIMARY KEY REFERENCES shipments(id),
      origin TEXT NOT NULL, destination TEXT NOT NULL, expected_date TEXT NOT NULL,
      notes TEXT NOT NULL, expected_expenses INTEGER NOT NULL CHECK (expected_expenses >= 0),
      allocation TEXT CHECK (allocation IN ('quantity', 'value'))
    ) STRICT;
    CREATE TABLE shipment_manifest_lines (
      shipment_id TEXT NOT NULL REFERENCES shipment_manifests(shipment_id),
      purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id),
      expected INTEGER NOT NULL CHECK (expected > 0),
      PRIMARY KEY (shipment_id, purchase_item_id)
    ) STRICT;
    CREATE INDEX manifest_by_purchase ON shipment_manifest_lines(purchase_item_id);
    CREATE TABLE shipment_receiving_events (
      id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL REFERENCES shipment_manifests(shipment_id),
      reference TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, recorded_at TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id), UNIQUE (id, shipment_id)
    ) STRICT;
    CREATE TABLE shipment_receiving_lines (
      event_id TEXT NOT NULL, shipment_id TEXT NOT NULL, purchase_item_id TEXT NOT NULL,
      usable INTEGER NOT NULL CHECK (usable >= 0),
      damaged INTEGER NOT NULL CHECK (damaged >= 0),
      missing INTEGER NOT NULL CHECK (missing >= 0),
      explanation TEXT NOT NULL,
      supplier_cost INTEGER NOT NULL CHECK (supplier_cost >= 0),
      damaged_supplier_cost INTEGER NOT NULL CHECK (damaged_supplier_cost >= 0),
      allocated_expense INTEGER NOT NULL CHECK (allocated_expense >= 0),
      capitalized_expense INTEGER NOT NULL CHECK (capitalized_expense BETWEEN 0 AND allocated_expense),
      movement_id TEXT UNIQUE REFERENCES stock_movements(id),
      PRIMARY KEY (event_id, purchase_item_id),
      FOREIGN KEY (event_id, shipment_id) REFERENCES shipment_receiving_events(id, shipment_id),
      FOREIGN KEY (shipment_id, purchase_item_id) REFERENCES shipment_manifest_lines(shipment_id, purchase_item_id),
      CHECK (usable + damaged + missing > 0),
      CHECK ((usable > 0) = (movement_id IS NOT NULL)),
      CHECK (damaged + missing = 0 OR length(trim(explanation)) > 0)
    ) STRICT;
    CREATE INDEX receiving_by_manifest_line ON shipment_receiving_lines(shipment_id, purchase_item_id);
    CREATE INDEX receiving_by_purchase ON shipment_receiving_lines(purchase_item_id);
    CREATE VIEW shipment_manifest_progress AS
      SELECT m.*, COALESCE(SUM(r.usable), 0) AS usable, COALESCE(SUM(r.damaged), 0) AS damaged,
        COALESCE(SUM(r.missing), 0) AS missing,
        m.expected - COALESCE(SUM(r.usable + r.damaged + r.missing), 0) AS outstanding
      FROM shipment_manifest_lines m LEFT JOIN shipment_receiving_lines r
        ON r.shipment_id = m.shipment_id AND r.purchase_item_id = m.purchase_item_id
      GROUP BY m.shipment_id, m.purchase_item_id;
    CREATE VIEW purchase_receiving_status AS
      SELECT i.*,
        COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE purchase_item_id = i.id), 0) AS received_quantity,
        COALESCE((SELECT SUM(damaged) FROM shipment_receiving_lines WHERE purchase_item_id = i.id), 0) AS damaged_quantity,
        COALESCE((SELECT SUM(outstanding) FROM shipment_manifest_progress WHERE purchase_item_id = i.id), 0) AS reserved_quantity
      FROM purchase_items i;
  `,
}, {
  version: 14,
  sql: `
    CREATE TABLE product_families (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE
    ) STRICT;
    ALTER TABLE products ADD COLUMN family_id TEXT REFERENCES product_families(id);
    ALTER TABLE products ADD COLUMN variant_size TEXT NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN variant_color TEXT NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN variant_material TEXT NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN variant_design TEXT NOT NULL DEFAULT '';
    CREATE INDEX products_by_family ON products(family_id);
    CREATE INDEX purchase_items_by_product ON purchase_items(product_id);
  `,
}, {
  version: 15,
  sql: `
    CREATE TABLE contacts_with_ids (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('Customer', 'Supplier', 'Agent')),
      name TEXT NOT NULL COLLATE NOCASE, phone TEXT NOT NULL, email TEXT NOT NULL, location TEXT NOT NULL
    ) STRICT;
    INSERT INTO contacts_with_ids SELECT id, kind, name, phone, email, location FROM contacts;
    DROP TABLE contacts;
    ALTER TABLE contacts_with_ids RENAME TO contacts;
    CREATE INDEX contacts_by_name ON contacts(kind, name);
    ALTER TABLE purchases ADD COLUMN supplier_id TEXT REFERENCES contacts(id);
    ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES contacts(id);
    ALTER TABLE online_orders ADD COLUMN customer_id TEXT REFERENCES contacts(id);
    CREATE INDEX purchases_by_contact ON purchases(supplier_id);
    CREATE INDEX sales_by_contact ON sales(customer_id);
    CREATE INDEX online_orders_by_contact ON online_orders(customer_id);
  `,
}, {
  version: 16,
  sql: `
    ALTER TABLE business_settings ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE business_settings ADD COLUMN channels TEXT NOT NULL DEFAULT '["Physical shop","Online"]';
    ALTER TABLE business_settings ADD COLUMN payment_labels TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE business_settings ADD COLUMN cny_rate_micros INTEGER CHECK (cny_rate_micros BETWEEN 1 AND 10000000000);
    ALTER TABLE business_settings ADD COLUMN usd_rate_micros INTEGER CHECK (usd_rate_micros BETWEEN 1 AND 10000000000);
  `,
}, {
  version: 17,
  sql: `
    CREATE TABLE shipment_claims (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, purchase_item_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('damage','shortage')),
      reference TEXT NOT NULL UNIQUE, claimant TEXT NOT NULL, notes TEXT NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('RWF','USD','CNY')),
      claimed INTEGER NOT NULL CHECK(claimed > 0), rate_micros INTEGER NOT NULL CHECK(rate_micros > 0),
      claimed_rwf INTEGER NOT NULL CHECK(claimed_rwf > 0),
      accepted_rwf INTEGER CHECK(accepted_rwf BETWEEN 0 AND claimed_rwf),
      actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      decision_actor TEXT REFERENCES users(id), decided_at TEXT,
      UNIQUE(event_id,purchase_item_id,kind),
      FOREIGN KEY(event_id,purchase_item_id) REFERENCES shipment_receiving_lines(event_id,purchase_item_id)
    ) STRICT;
    CREATE TABLE shipment_resolutions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, purchase_item_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('damage','shortage')),
      action TEXT NOT NULL CHECK(action IN ('credit','cash','recover','loss','return','reverse')),
      reference TEXT NOT NULL UNIQUE, notes TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0), quantity INTEGER NOT NULL CHECK(quantity >= 0),
      account_id TEXT REFERENCES accounts(id), claim_id TEXT REFERENCES shipment_claims(id),
      movement_id TEXT UNIQUE REFERENCES stock_movements(id),
      reverses_id TEXT UNIQUE REFERENCES shipment_resolutions(id),
      actor_id TEXT NOT NULL REFERENCES users(id), recorded_at TEXT NOT NULL,
      FOREIGN KEY(event_id,purchase_item_id) REFERENCES shipment_receiving_lines(event_id,purchase_item_id)
    ) STRICT;
    CREATE INDEX resolution_by_line ON shipment_resolutions(event_id,purchase_item_id,kind);
    CREATE INDEX resolution_by_purchase ON shipment_resolutions(purchase_item_id,action);
    CREATE VIEW active_shipment_resolutions AS SELECT r.* FROM shipment_resolutions r
      WHERE r.action <> 'reverse' AND NOT EXISTS (SELECT 1 FROM shipment_resolutions x WHERE x.reverses_id = r.id);
  `,
}, {
  version: 18,
  sql: `
    ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'RWF' CHECK(currency IN ('RWF','USD','CNY'));
    ALTER TABLE accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
    ALTER TABLE money_transactions ADD COLUMN source_minor INTEGER CHECK(source_minor > 0);
    ALTER TABLE money_transactions ADD COLUMN destination_minor INTEGER CHECK(destination_minor > 0);
    ALTER TABLE money_transactions ADD COLUMN settlement_currency TEXT CHECK(settlement_currency IN ('RWF','USD','CNY'));
    ALTER TABLE money_transactions ADD COLUMN settlement_rate INTEGER CHECK(settlement_rate > 0);
    ALTER TABLE money_transactions ADD COLUMN exchange_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(exchange_fee_minor >= 0);
    ALTER TABLE money_transactions ADD COLUMN exchange_fee_rwf INTEGER NOT NULL DEFAULT 0 CHECK(exchange_fee_rwf >= 0);
    ALTER TABLE money_transactions ADD COLUMN payable_amount INTEGER CHECK(payable_amount >= 0);
    ALTER TABLE money_transactions ADD COLUMN payable_minor INTEGER CHECK(payable_minor > 0);
    ALTER TABLE money_transactions ADD COLUMN fx_difference INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX money_from_account ON money_transactions(from_account);
    CREATE INDEX money_to_account ON money_transactions(to_account);
  `,
}, {
  version: 19,
  sql: `
    ALTER TABLE sales ADD COLUMN request_payload TEXT;
    CREATE INDEX payments_by_reference ON payments(reference_number COLLATE NOCASE);
  `,
}, {
  version: 20,
  sql: `
    ALTER TABLE shipment_resolutions ADD COLUMN payable_minor INTEGER CHECK(payable_minor > 0);
  `,
}, {
  version: 21,
  sql: `
    ALTER TABLE shipment_resolutions ADD COLUMN purchase_closed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(purchase_closed_quantity >= 0);
    ALTER TABLE money_transactions ADD COLUMN settled_at TEXT;
    DROP VIEW purchase_receiving_status;
    CREATE VIEW purchase_receiving_status AS
      SELECT i.*,
        COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE purchase_item_id = i.id), 0) AS received_quantity,
        COALESCE((SELECT SUM(damaged) FROM shipment_receiving_lines WHERE purchase_item_id = i.id), 0) AS damaged_quantity,
        COALESCE((SELECT SUM(outstanding) FROM shipment_manifest_progress WHERE purchase_item_id = i.id), 0) AS reserved_quantity,
        COALESCE((SELECT SUM(purchase_closed_quantity) FROM active_shipment_resolutions WHERE purchase_item_id = i.id), 0) AS closed_quantity
      FROM purchase_items i;
  `,
}, {
  version: 22,
  sql: `
    ALTER TABLE business_settings ADD COLUMN expense_categories TEXT NOT NULL DEFAULT '["Shop Rent","Electricity","Water","Internet and Airtime","Transport","Packaging","Advertising","Cleaning","Repairs and Maintenance","Office Supplies","Bank or Mobile Money Charges","Professional Services","Other Operating Expenses"]';
    ALTER TABLE money_transactions ADD COLUMN expense_details TEXT;
    ALTER TABLE money_transactions ADD COLUMN expense_request TEXT;
    ALTER TABLE purchases ADD COLUMN request_key TEXT;
    ALTER TABLE purchases ADD COLUMN request_payload TEXT;
    CREATE UNIQUE INDEX purchases_retry_key ON purchases(request_key);
    CREATE VIEW operating_expense_entries AS
      SELECT m.id,m.reference,CASE WHEN m.kind='transfer' THEN 'Bank or Mobile Money Charges' ELSE COALESCE(NULLIF(m.category,''),'Uncategorized') END AS category,
        COALESCE(m.settled_at,m.recorded_at) AS effective_at,m.actor_id,m.from_account AS account_id,
        CASE WHEN m.kind='transfer' THEN m.exchange_fee_rwf ELSE m.amount END AS amount,
        CASE WHEN m.kind='transfer' THEN m.exchange_fee_minor ELSE COALESCE(m.source_minor,m.amount) END AS native_amount,
        COALESCE(m.settlement_currency,'RWF') AS currency,m.expense_details,
        CASE WHEN EXISTS(SELECT 1 FROM money_reversals r WHERE r.transaction_id=m.id) THEN 'Reversed' ELSE 'Posted' END AS status,
        NULL AS original_id,NULL AS reversal_reason,m.kind AS source_kind
      FROM money_transactions m WHERE (m.kind='expense' AND m.shipment_id IS NULL) OR m.exchange_fee_rwf>0
      UNION ALL
      SELECT r.id,'reversal:' || m.reference,CASE WHEN m.kind='transfer' THEN 'Bank or Mobile Money Charges' ELSE COALESCE(NULLIF(m.category,''),'Uncategorized') END,
        r.recorded_at,r.actor_id,m.from_account,CASE WHEN m.kind='transfer' THEN -m.exchange_fee_rwf ELSE -m.amount END,
        CASE WHEN m.kind='transfer' THEN -m.exchange_fee_minor ELSE -COALESCE(m.source_minor,m.amount) END,
        COALESCE(m.settlement_currency,'RWF'),m.expense_details,'Reversal',m.id,r.reason,m.kind
      FROM money_reversals r JOIN money_transactions m ON m.id=r.transaction_id
      WHERE (m.kind='expense' AND m.shipment_id IS NULL) OR m.exchange_fee_rwf>0;
  `,
}, {
  version: 23,
  sql: `
    CREATE TABLE expense_receipts (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL REFERENCES money_transactions(id),
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
      contents BLOB NOT NULL CHECK(length(contents) BETWEEN 1 AND 2097152),
      digest TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(expense_id,digest)
    ) STRICT;
  `,
}, {
  version: 24,
  sql: `
    CREATE TABLE password_resets (
      owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL
    ) STRICT;
  `,
}];
