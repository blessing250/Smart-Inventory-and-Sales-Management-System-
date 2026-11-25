export const reportTitles = {
  inventory: 'Current stock and valuation',
  'low-stock': 'Low stock',
  movements: 'Stock movements',
  purchases: 'Purchase orders',
  suppliers: 'Current supplier balances by purchase',
  shipments: 'Shipment costs by creation date',
  receiving: 'Shipment receiving and reconciliation',
  reconciliation: 'Current shipment reconciliation',
  receivables: 'Current receivables by sale',
  accounts: 'Current account balances',
  'native-accounts': 'Account balances by native currency',
  expenses: 'Operating expenses and reversals',
  'shipment-finance': 'Shipment credits, compensation and losses',
  'currency-finance': 'Foreign settlements and exchanges',
  products: 'Sales by product',
  channels: 'Sales by channel',
  profitability: 'Income and gross profit',
} as const;

export type ReportName = keyof typeof reportTitles;
export type ReportRow = (string | number)[];
export type OperationalReport = { title: string; columns: string[]; rows: ReportRow[]; scope: string;
  totals?: { amount: number; groups: { category: string; amount: number }[] } };
