import {
  DashboardStats,
  Payment,
  Product,
  Purchase,
  PurchaseItem,
  Sale,
  SaleItem,
  StockMovement,
  User,
} from '@/app/types/inventory';
import bcrypt from 'bcryptjs';

const makeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

class DataStore {
  private users: User[] = [
    {
      id: '1',
      name: 'Admin User',
      email: 'admin@inventory.com',
      password_hash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      created_at: '2026-05-26T08:00:00.000Z',
    },
    {
      id: '2',
      name: 'Employee User',
      email: 'employee@inventory.com',
      password_hash: bcrypt.hashSync('employee123', 10),
      role: 'employee',
      created_at: '2026-05-26T08:15:00.000Z',
    },
  ];

  private products: Product[] = [
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

  private purchases: Purchase[] = [
    {
      id: 'P-3001',
      supplier_name: 'ABC Ltd',
      total_amount: 100000,
      purchase_date: '2026-05-26T07:40:00.000Z',
      created_at: '2026-05-26T07:40:00.000Z',
    },
  ];

  private purchaseItems: PurchaseItem[] = [
    {
      id: 'PI-1',
      purchase_id: 'P-3001',
      product_id: '1',
      quantity: 100,
      unit_cost: 1000,
      subtotal: 100000,
    },
  ];

  private sales: Sale[] = [
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
  ];

  private saleItems: SaleItem[] = [
    {
      id: 'SI-1',
      sale_id: 'S-1001',
      product_id: '1',
      quantity: 5,
      selling_price: 1500,
      subtotal: 7500,
    },
    {
      id: 'SI-2',
      sale_id: 'S-1001',
      product_id: '2',
      quantity: 2,
      selling_price: 2000,
      subtotal: 4000,
    },
  ];

  private payments: Payment[] = [
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
  ];

  private stockMovements: StockMovement[] = [
    {
      id: 'SM-1',
      product_id: '1',
      product_name: 'Sugar',
      type: 'Stock In',
      quantity: 100,
      movement_date: '2026-05-26T07:40:00.000Z',
      remaining_stock: 103,
    },
    {
      id: 'SM-2',
      product_id: '1',
      product_name: 'Sugar',
      type: 'Stock Out',
      quantity: 5,
      movement_date: '2026-05-26T11:20:00.000Z',
      remaining_stock: 98,
    },
  ];

  private toPublicUser(user: User): Omit<User, 'password_hash'> {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
    };
  }

  getUsers(): Omit<User, 'password_hash'>[] {
    return this.users.map((user) => this.toPublicUser(user));
  }

  getUserByEmail(email: string): User | undefined {
    return this.users.find((user) => user.email === email);
  }

  createUser(user: { name: string; email: string; password: string; role: User['role'] }): Omit<User, 'password_hash'> | { error: string } {
    const existing = this.getUserByEmail(user.email);
    if (existing) return { error: 'A user with this email already exists.' };

    const newUser: User = {
      id: makeId('USR'),
      name: user.name,
      email: user.email,
      password_hash: bcrypt.hashSync(user.password, 10),
      role: user.role,
      created_at: new Date().toISOString(),
    };

    this.users.unshift(newUser);
    return this.toPublicUser(newUser);
  }

  updateUser(id: string, updates: { name?: string; email?: string; password?: string; role?: User['role'] }): Omit<User, 'password_hash'> | undefined | { error: string } {
    const index = this.users.findIndex((user) => user.id === id);
    if (index === -1) return undefined;

    if (updates.email && this.users.some((user) => user.id !== id && user.email === updates.email)) {
      return { error: 'A user with this email already exists.' };
    }

    this.users[index] = {
      ...this.users[index],
      ...(updates.name ? { name: updates.name } : {}),
      ...(updates.email ? { email: updates.email } : {}),
      ...(updates.role ? { role: updates.role } : {}),
      ...(updates.password ? { password_hash: bcrypt.hashSync(updates.password, 10) } : {}),
    };

    return this.toPublicUser(this.users[index]);
  }

  deleteUser(id: string): boolean | { error: string } {
    const index = this.users.findIndex((user) => user.id === id);
    if (index === -1) return false;
    if (this.users[index].role === 'admin' && this.users.filter((user) => user.role === 'admin').length === 1) {
      return { error: 'At least one admin user is required.' };
    }

    this.users.splice(index, 1);
    return true;
  }

  getProducts(): Product[] {
    return [...this.products];
  }

  getProductById(id: string): Product | undefined {
    return this.products.find((product) => product.id === id);
  }

  createProduct(product: Omit<Product, 'id' | 'created_at'>): Product {
    const newProduct: Product = {
      ...product,
      id: makeId('PRD'),
      created_at: new Date().toISOString(),
    };
    this.products.unshift(newProduct);
    return newProduct;
  }

  updateProduct(id: string, updates: Partial<Omit<Product, 'id' | 'created_at'>>): Product | undefined {
    const index = this.products.findIndex((product) => product.id === id);
    if (index === -1) return undefined;

    this.products[index] = { ...this.products[index], ...updates };
    return this.products[index];
  }

  deleteProduct(id: string): boolean {
    const index = this.products.findIndex((product) => product.id === id);
    if (index === -1) return false;

    this.products.splice(index, 1);
    return true;
  }

  getPurchases() {
    return this.purchases.map((purchase) => ({
      ...purchase,
      items: this.purchaseItems.filter((item) => item.purchase_id === purchase.id),
    }));
  }

  createPurchase(
    supplier_name: string,
    items: Array<{ product_id: string; quantity: number; unit_cost: number }>
  ): Purchase {
    const purchaseId = makeId('PUR');
    const purchaseItems = items.map((item) => ({
      ...item,
      id: makeId('PI'),
      purchase_id: purchaseId,
      subtotal: item.quantity * item.unit_cost,
    }));

    const purchase: Purchase = {
      id: purchaseId,
      supplier_name,
      total_amount: purchaseItems.reduce((sum, item) => sum + item.subtotal, 0),
      purchase_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    this.purchases.unshift(purchase);
    this.purchaseItems.unshift(...purchaseItems);

    purchaseItems.forEach((item) => {
      const product = this.getProductById(item.product_id);
      if (!product) return;

      const updated = this.updateProduct(product.id, {
        quantity: product.quantity + item.quantity,
        purchase_price: item.unit_cost,
      });

      if (updated) {
        this.stockMovements.unshift({
          id: makeId('SM'),
          product_id: updated.id,
          product_name: updated.name,
          type: 'Stock In',
          quantity: item.quantity,
          movement_date: purchase.purchase_date,
          remaining_stock: updated.quantity,
        });
      }
    });

    return purchase;
  }

  getSales() {
    return this.sales.map((sale) => ({
      ...sale,
      items: this.saleItems.filter((item) => item.sale_id === sale.id),
    }));
  }

  createSale(
    customer_name: string | null,
    payment_method: Sale['payment_method'],
    items: Array<{ product_id: string; quantity: number }>
  ): Sale | { error: string } {
    type HydratedSaleItem =
      | {
          product: Product;
          quantity: number;
          selling_price: number;
          subtotal: number;
        }
      | { error: string };

    const hydratedItems: HydratedSaleItem[] = items.map((item) => {
      const product = this.getProductById(item.product_id);
      if (!product) {
        return { error: `Product ${item.product_id} was not found.` };
      }
      if (product.quantity < item.quantity) {
        return { error: `${product.name} has only ${product.quantity} units in stock.` };
      }
      return {
        product,
        quantity: item.quantity,
        selling_price: product.selling_price,
        subtotal: product.selling_price * item.quantity,
      };
    });

    const failed = hydratedItems.find((item): item is { error: string } => 'error' in item);
    if (failed) return { error: failed.error };

    const saleId = makeId('SAL');
    const saleDate = new Date().toISOString();
    const saleItems = hydratedItems.map((item) => {
      if ('error' in item) throw new Error(item.error);
      return {
        id: makeId('SI'),
        sale_id: saleId,
        product_id: item.product.id,
        quantity: item.quantity,
        selling_price: item.selling_price,
        subtotal: item.subtotal,
      };
    });

    const sale: Sale = {
      id: saleId,
      customer_name,
      total_amount: saleItems.reduce((sum, item) => sum + item.subtotal, 0),
      payment_method,
      sale_date: saleDate,
      created_at: saleDate,
    };

    this.sales.unshift(sale);
    this.saleItems.unshift(...saleItems);

    saleItems.forEach((item) => {
      const product = this.getProductById(item.product_id);
      if (!product) return;
      const updated = this.updateProduct(product.id, {
        quantity: product.quantity - item.quantity,
      });

      if (updated) {
        this.stockMovements.unshift({
          id: makeId('SM'),
          product_id: updated.id,
          product_name: updated.name,
          type: 'Stock Out',
          quantity: item.quantity,
          movement_date: saleDate,
          remaining_stock: updated.quantity,
        });
      }
    });

    this.payments.unshift({
      id: makeId('PAY'),
      sale_id: saleId,
      reference_number: payment_method === 'Cash' ? `CASH-${saleId}` : makeId('REF'),
      amount: sale.total_amount,
      method: payment_method,
      status: payment_method === 'Credit' ? 'Pending' : 'Paid',
      payment_date: saleDate,
    });

    return sale;
  }

  getPayments(): Payment[] {
    return [...this.payments];
  }

  createPayment(payment: Omit<Payment, 'id' | 'payment_date' | 'reference_number'> & { reference_number?: string }) {
    const newPayment: Payment = {
      ...payment,
      id: makeId('PAY'),
      reference_number: payment.reference_number || makeId('REF'),
      payment_date: new Date().toISOString(),
    };
    this.payments.unshift(newPayment);
    return newPayment;
  }

  getStockMovements(): StockMovement[] {
    return [...this.stockMovements];
  }

  moveStock(product_id: string, quantity: number, type: StockMovement['type']) {
    const product = this.getProductById(product_id);
    if (!product) return { error: 'Product not found.' };

    const nextQuantity = type === 'Stock In' ? product.quantity + quantity : product.quantity - quantity;
    if (nextQuantity < 0) return { error: 'Stock out quantity is greater than current stock.' };

    const updated = this.updateProduct(product_id, { quantity: nextQuantity });
    if (!updated) return { error: 'Unable to update product.' };

    const movement: StockMovement = {
      id: makeId('SM'),
      product_id,
      product_name: updated.name,
      type,
      quantity,
      movement_date: new Date().toISOString(),
      remaining_stock: updated.quantity,
    };
    this.stockMovements.unshift(movement);
    return movement;
  }

  getDashboardStats(): DashboardStats {
    const today = new Date().toISOString().slice(0, 10);
    const todaysSales = this.sales.filter((sale) => sale.sale_date.startsWith(today));
    const totalRevenue = this.sales.reduce((sum, sale) => sum + sale.total_amount, 0);
    const totalExpenses = this.purchases.reduce((sum, purchase) => sum + purchase.total_amount, 0);

    return {
      total_products: this.products.length,
      total_stock: this.products.reduce((sum, product) => sum + product.quantity, 0),
      total_sales_today: todaysSales.length,
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      total_profit: totalRevenue - totalExpenses,
      low_stock_items: this.products.filter((product) => product.quantity <= product.minimum_quantity),
    };
  }

  getReports() {
    const stats = this.getDashboardStats();
    const soldByProduct = new Map<string, { product: string; units: number; revenue: number }>();

    this.saleItems.forEach((item) => {
      const product = this.getProductById(item.product_id);
      const key = product?.name || item.product_id;
      const current = soldByProduct.get(key) || { product: key, units: 0, revenue: 0 };
      soldByProduct.set(key, {
        product: key,
        units: current.units + item.quantity,
        revenue: current.revenue + item.subtotal,
      });
    });

    return {
      daily: {
        products_sold: this.saleItems.reduce((sum, item) => sum + item.quantity, 0),
        revenue: stats.total_revenue,
        expenses: stats.total_expenses,
        profit: stats.total_profit,
      },
      monthly: {
        best_selling_products: Array.from(soldByProduct.values()).sort((a, b) => b.units - a.units),
        revenue: stats.total_revenue,
        purchases: stats.total_expenses,
        profit: stats.total_profit,
        remaining_stock: stats.total_stock,
      },
    };
  }
}

export const dataStore = new DataStore();
