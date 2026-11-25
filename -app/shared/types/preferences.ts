export type Preferences = {
  expense_categories?: string[];
  categories: string[];
  channels: string[];
  payment_labels: Partial<Record<'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Credit', string>>;
  cny_rate_micros: number | null;
  usd_rate_micros: number | null;
};
