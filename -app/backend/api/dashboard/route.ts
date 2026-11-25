import { dataStore } from '@/backend/database/data-store';
import { ownerRoute } from '@/backend/auth/auth-utils';
export const GET = ownerRoute(() => ({
  stats: dataStore.getDashboardStats(), products: dataStore.getProducts(), sales: dataStore.getSales().slice(0, 10),
  activities: dataStore.getFinance().transactions.slice(0, 6), purchases: dataStore.getPurchases().slice(0, 6),
  accountBalances: dataStore.getAccountBalances(),
}));
