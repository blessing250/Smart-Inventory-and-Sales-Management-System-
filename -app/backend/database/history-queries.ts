import type { HistoryQuery } from '../../shared/validation/history-input';
import { saleBalanceSql } from './sale-balance-sql';

// Every projection uses the same public columns. Query parameters are bound by the store.
const queries: Record<HistoryQuery['resource'], string> = {
  products: `SELECT p.id, p.name, p.sku AS reference, p.category AS status, p.created_at AS recorded_at,
    p.quantity AS amount, COALESCE(f.name,'') AS detail, NULL AS from_account, NULL AS to_account
    FROM products p LEFT JOIN product_families f ON f.id = p.family_id WHERE p.archived_at IS NULL`,
  stock: `SELECT id, product_name AS name, COALESCE(receipt_reference,id) AS reference, type AS status,
    movement_date AS recorded_at, quantity AS amount, reason AS detail, NULL AS from_account, NULL AS to_account FROM stock_movements`,
  purchases: `SELECT id, supplier_name AS name, id AS reference, currency AS status,
    purchase_date AS recorded_at, total_amount AS amount, invoice_reference AS detail, NULL AS from_account, NULL AS to_account FROM purchases`,
  shipments: `SELECT id, agent AS name, reference, status, created_at AS recorded_at, NULL AS amount,
    '' AS detail, NULL AS from_account, NULL AS to_account FROM shipments`,
  receipts: `SELECT e.id, s.reference AS name, e.reference, '' AS status, e.recorded_at,
    (SELECT SUM(usable + damaged) FROM shipment_receiving_lines WHERE event_id = e.id) AS amount,
    '' AS detail, NULL AS from_account, NULL AS to_account FROM shipment_receiving_events e JOIN shipments s ON s.id = e.shipment_id
    UNION ALL SELECT m.id,s.reference,COALESCE(m.receipt_reference,m.id),'legacy receipt',m.movement_date,m.quantity,
      m.product_name,NULL,NULL FROM shipment_receipt_items r JOIN stock_movements m ON m.id = r.movement_id
      JOIN shipments s ON s.id = r.shipment_id`,
  sales: `SELECT s.id, COALESCE(s.customer_name,'Walk-in') AS name, s.id AS reference,
    CASE WHEN s.balance = 0 THEN 'settled' WHEN EXISTS (
      SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'Paid' AND NOT EXISTS (
        SELECT 1 FROM money_reversals r JOIN money_transactions m ON m.id = r.transaction_id WHERE m.payment_id = p.id))
      THEN 'partial' ELSE 'unpaid' END AS status,
    s.sale_date AS recorded_at, s.total_amount AS amount,
    s.channel || ' · Outstanding RWF ' || s.balance || ' · ' ||
      COALESCE((SELECT GROUP_CONCAT(reference_number, ' · ') FROM payments WHERE sale_id = s.id),'') AS detail,
    NULL AS from_account, NULL AS to_account FROM (SELECT s.*, ${saleBalanceSql} AS balance FROM sales s) s`,
  contacts: `SELECT id, name, id AS reference, kind AS status, NULL AS recorded_at, NULL AS amount,
    phone || ' ' || email || ' ' || location AS detail, NULL AS from_account, NULL AS to_account FROM contacts`,
  orders: `SELECT id, customer_name AS name, id AS reference, status, created_at AS recorded_at, NULL AS amount,
    source || ' · ' || delivery_status AS detail, NULL AS from_account, NULL AS to_account FROM online_orders`,
  finance: `SELECT m.id, COALESCE(a.name,'') || CASE WHEN b.id IS NULL THEN '' WHEN a.id IS NULL THEN b.name ELSE ' → ' || b.name END AS name,
    m.reference, CASE WHEN r.id IS NOT NULL THEN 'reversed' WHEN m.shipment_id IS NOT NULL THEN 'shipment_payment'
      WHEN m.kind = 'transfer' AND a.currency <> b.currency THEN 'exchange' ELSE m.kind END AS status,
    COALESCE(m.settled_at,m.recorded_at) AS recorded_at, m.amount, TRIM(COALESCE(m.category,'') ||
      CASE WHEN a.currency IS NULL OR m.source_minor IS NULL THEN '' ELSE
        ' · From ' || a.currency || ' ' || CASE WHEN a.currency = 'RWF' THEN CAST(m.source_minor AS TEXT)
          ELSE printf('%d.%02d',m.source_minor / 100,m.source_minor % 100) END END ||
      CASE WHEN b.currency IS NULL OR m.destination_minor IS NULL THEN '' ELSE
        ' · To ' || b.currency || ' ' || CASE WHEN b.currency = 'RWF' THEN CAST(m.destination_minor AS TEXT)
          ELSE printf('%d.%02d',m.destination_minor / 100,m.destination_minor % 100) END END ||
      CASE WHEN m.fx_difference <> 0 THEN ' · FX result RWF ' || m.fx_difference ELSE '' END ||
      CASE WHEN m.settlement_rate IS NOT NULL AND m.settlement_currency <> 'RWF'
        THEN ' · Captured rate ' || printf('%d.%06d',m.settlement_rate / 1000000,m.settlement_rate % 1000000) || ' RWF/' || m.settlement_currency ELSE '' END ||
      CASE WHEN m.exchange_fee_rwf > 0 THEN ' · Fee RWF ' || m.exchange_fee_rwf ELSE '' END) AS detail, m.from_account, m.to_account
    FROM money_transactions m LEFT JOIN money_reversals r ON r.transaction_id = m.id
    LEFT JOIN accounts a ON a.id = m.from_account LEFT JOIN accounts b ON b.id = m.to_account
    UNION ALL SELECT r.id, COALESCE(a.name,''), r.reference, r.action, r.recorded_at, r.amount, r.notes, NULL, r.account_id
      FROM shipment_resolutions r LEFT JOIN accounts a ON a.id = r.account_id
    UNION ALL SELECT r.id, COALESCE(a.name,''), r.reference, 'refund', r.recorded_at, r.refund, r.reason, r.refund_account, NULL
      FROM sale_returns r LEFT JOIN accounts a ON a.id = r.refund_account WHERE r.refund > 0
    UNION ALL SELECT r.id, COALESCE(a.name,'') || CASE WHEN b.id IS NULL THEN '' WHEN a.id IS NULL THEN b.name ELSE ' → ' || b.name END,
      'reversal:' || m.reference, 'reversal', r.recorded_at, -m.amount, r.reason, m.to_account, m.from_account
      FROM money_reversals r JOIN money_transactions m ON m.id = r.transaction_id
      LEFT JOIN accounts a ON a.id = m.to_account LEFT JOIN accounts b ON b.id = m.from_account`,
  audit: `SELECT l.id, u.name, l.entity_id AS reference, l.action AS status, l.recorded_at, NULL AS amount,
    '' AS detail, NULL AS from_account, NULL AS to_account FROM audit_log l JOIN users u ON u.id = l.actor_id`,
};


export function historySql(query: HistoryQuery) {
  const terms = [];
  const params: string[] = [];
  if (query.q) {
    terms.push("instr(lower(name || ' ' || reference || ' ' || status || ' ' || detail), lower(?)) > 0");
    params.push(query.q);
  }
  if (query.status) { terms.push('status = ? COLLATE NOCASE'); params.push(query.status); }
  if (query.account) { terms.push('(from_account = ? OR to_account = ?)'); params.push(query.account, query.account); }
  // Kigali uses UTC+02 year round. Use inclusive date boundaries with normalized date values.
  if (query.start) { terms.push("date(recorded_at,'+2 hours') >= ?"); params.push(query.start); }
  if (query.end) { terms.push("date(recorded_at,'+2 hours') <= ?"); params.push(query.end); }
  const from = `FROM (${queries[query.resource]})${terms.length ? ' WHERE ' + terms.join(' AND ') : ''}`;
  const order = { latest: 'recorded_at DESC', oldest: 'recorded_at ASC', name: 'name COLLATE NOCASE ASC', amount: 'amount DESC' }[query.sort];
  return { from, order: `${order}, id ASC`, params };
}
