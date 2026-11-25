// User types
export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'employee';
  created_at: string;
}

// Product types
export interface Product {
  family?: string | null;
  variant_size?: string;
  variant_color?: string;
  variant_material?: string;
  variant_design?: string;
  awaiting_receipt?: number;
  damaged_recorded?: number;
  missing_recorded?: number;
  sku?: string;
  description?: string;
  stock_value?: number;
  has_image?: number;
  id: string;
  name: string;
  category: string;
  purchase_price: number;
  selling_price: number;
  quantity: number;
  minimum_quantity: number;
  supplier: string;
  created_at: string;
}

// Purchase types
export interface Purchase {
  currency?: 'RWF' | 'CNY' | 'USD';
  rate_micros?: number;
  invoice_reference?: string;
  id: string;
  supplier_name: string;
  total_amount: number;
  purchase_date: string;
  created_at: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  subtotal: number;
}

// Sales types
export interface Sale {
  channel?: string;
  id: string;
  customer_name: string | null;
  total_amount: number;
  payment_method: 'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Credit';
  sale_date: string;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  selling_price: number;
  subtotal: number;
}

// Payment types
export interface Payment {
  reversed?: number;
  id: string;
  sale_id: string;
  reference_number: string;
  amount: number;
  method: 'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Credit';
  status: 'Paid' | 'Pending' | 'Failed';
  payment_date: string;
}

export interface StockMovement {
  reason?: string;
  disposition?: 'Damaged' | 'Missing' | null;
  id: string;
  product_id: string;
  product_name: string;
  type: 'Stock In' | 'Stock Out';
  quantity: number;
  movement_date: string;
  remaining_stock: number;
}

// Dashboard stats
export interface DashboardStats {
  total_products: number;
  total_stock: number;
  total_sales_today: number;
  total_revenue: number;
  total_expenses: number;
  total_profit: number;
  inventory_value: number;
  monthly_sales: number;
  monthly_expenses: number;
  supplier_balance: number;
  customer_balance: number;
  available_funds: number;
  pending_shipments: number;
  unresolved_shipments: number;
  gross_profit_today: number;
  low_stock_items: Product[];
}
