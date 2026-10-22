import type { Payment, Product, Purchase, Sale } from '@/app/types/inventory';

export const formatRwf = (amount: number) =>
  `RWF ${new Intl.NumberFormat('en-RW', {
    maximumFractionDigits: 0,
  }).format(amount)}`;

export const products: Product[] = [
  {
    id: '1',
    name: 'Sugar',
    category: 'Food Items',
    purchase_price: 1000,
    selling_price: 1500,
    quantity: 3,
    minimum_quantity: 5,
    supplier: 'ABC Ltd',
    created_at: '2026-05-26T08:00:00.000Z',
  },
  {
    id: '2',
    name: 'Rice',
    category: 'Food Items',
    purchase_price: 1200,
    selling_price: 2000,
    quantity: 48,
    minimum_quantity: 10,
    supplier: 'Kigali Foods',
    created_at: '2026-05-24T10:30:00.000Z',
  },
  {
    id: '3',
    name: 'Cooking Oil',
    category: 'Household',
    purchase_price: 3200,
    selling_price: 4200,
    quantity: 18,
    minimum_quantity: 6,
    supplier: 'Sunrise Traders',
    created_at: '2026-05-20T09:15:00.000Z',
  },
  {
    id: '4',
    name: 'Beans',
    category: 'Food Items',
    purchase_price: 700,
    selling_price: 1100,
    quantity: 64,
    minimum_quantity: 12,
    supplier: 'ABC Ltd',
    created_at: '2026-05-18T12:00:00.000Z',
  },
];

export const sales: Sale[] = [
  {
    id: 'S-1001',
    customer_name: 'Walk-in Customer',
    total_amount: 11500,
    payment_method: 'Mobile Money',
    sale_date: '2026-05-26T11:20:00.000Z',
    created_at: '2026-05-26T11:20:00.000Z',
  },
  {
    id: 'S-1000',
    customer_name: 'Mutesi Alice',
    total_amount: 20000,
    payment_method: 'Cash',
    sale_date: '2026-05-26T09:35:00.000Z',
    created_at: '2026-05-26T09:35:00.000Z',
  },
  {
    id: 'S-0999',
    customer_name: 'Credit Customer',
    total_amount: 15000,
    payment_method: 'Credit',
    sale_date: '2026-05-25T16:10:00.000Z',
    created_at: '2026-05-25T16:10:00.000Z',
  },
];

export const purchases: Purchase[] = [
  {
    id: 'P-3001',
    supplier_name: 'ABC Ltd',
    total_amount: 100000,
    purchase_date: '2026-05-26T07:40:00.000Z',
    created_at: '2026-05-26T07:40:00.000Z',
  },
  {
    id: 'P-3000',
    supplier_name: 'Kigali Foods',
    total_amount: 144000,
    purchase_date: '2026-05-21T13:00:00.000Z',
    created_at: '2026-05-21T13:00:00.000Z',
  },
];

export const payments: Payment[] = [
  {
    id: 'PAY-9001',
    sale_id: 'S-1001',
    reference_number: 'MOMO-44512',
    amount: 11500,
    method: 'Mobile Money',
    status: 'Paid',
    payment_date: '2026-05-26T11:22:00.000Z',
  },
  {
    id: 'PAY-9000',
    sale_id: 'S-1000',
    reference_number: 'CASH-1000',
    amount: 20000,
    method: 'Cash',
    status: 'Paid',
    payment_date: '2026-05-26T09:36:00.000Z',
  },
  {
    id: 'PAY-8999',
    sale_id: 'S-0999',
    reference_number: 'CR-8999',
    amount: 15000,
    method: 'Credit',
    status: 'Pending',
    payment_date: '2026-05-25T16:12:00.000Z',
  },
];

export const todayIsoDate = '2026-05-26';

export const getDashboardMetrics = () => {
  const todaySales = sales.filter((sale) => sale.sale_date.startsWith(todayIsoDate));
  const revenue = todaySales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const expenses = purchases.reduce((sum, purchase) => sum + purchase.total_amount, 0);

  return {
    totalProducts: products.length,
    totalStock: products.reduce((sum, product) => sum + product.quantity, 0),
    totalSalesToday: todaySales.length,
    totalRevenue: revenue,
    totalExpenses: expenses,
    totalProfit: revenue - expenses,
    lowStockItems: products.filter((product) => product.quantity <= product.minimum_quantity),
  };
};
