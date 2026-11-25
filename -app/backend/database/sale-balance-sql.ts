// The caller selects from sales as s. Reversed collections and refunded credits settle their original postings.
export const saleBalanceSql = `s.total_amount -
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.sale_id = s.id AND p.status = 'Paid'
   AND NOT EXISTS (SELECT 1 FROM money_reversals r JOIN money_transactions m ON m.id = r.transaction_id WHERE m.payment_id = p.id)) -
  (SELECT COALESCE(SUM(r.revenue_credit - r.refund), 0) FROM sale_returns r
   JOIN sale_items i ON i.id = r.sale_item_id WHERE i.sale_id = s.id)`;
