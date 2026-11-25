import type { DataStore } from '../database/data-store';
import { BusinessError } from '../database/data-store';
import { reportPeriod } from './report-period';
import { reportTitles, type OperationalReport, type ReportName, type ReportRow } from '../../shared/types/operational-report';
import { businessDate as day, businessPeriod } from '../../shared/business-date';
import { formatNative } from '../../shared/finance/native-display';
import { expenseFilters } from '../../shared/validation/expense-input';

export function operationalReport(store: DataStore, query: URLSearchParams): OperationalReport {
  const key = query.get('report') ?? '';
  if (!Object.hasOwn(reportTitles, key)) throw new BusinessError('Choose an available report.');
  const report = key as ReportName;
  const period = reportPeriod(query);
  const month = day(new Date()).slice(0, 7);
  const matches = businessPeriod(period, month);
  const periodLabel = period.start || period.end
    ? `${period.start ?? 'Earliest'} to ${period.end ?? 'latest'} (Kigali dates)` : `Current month ${month} (Kigali dates)`;
  const result = (columns: string[], rows: ReportRow[], scope = periodLabel): OperationalReport => {
    const search = (query.get('q') ?? '').trim().toLowerCase();
    const sort = query.get('sort') || 'recorded';
    const filtered = rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(search)));
    if (sort === 'asc' || sort === 'desc') filtered.sort((a, b) => String(a[0]).localeCompare(String(b[0])) * (sort === 'asc' ? 1 : -1));
    return { title: reportTitles[report], columns, rows: filtered, scope };
  };
  switch (report) {
    case 'inventory':
    case 'low-stock':
      return result(['Product', 'SKU', 'Available', 'Reorder at', 'Awaiting receipt', 'Recorded damaged', 'Recorded missing', 'Value (RWF)'],
        store.getProducts().filter(row => report === 'inventory' || row.quantity <= row.minimum_quantity)
          .map(row => [row.name, row.sku ?? '', row.quantity, row.minimum_quantity, row.awaiting_receipt ?? 0,
            row.damaged_recorded ?? 0, row.missing_recorded ?? 0, row.stock_value ?? 0]), 'Current snapshot');
    case 'movements':
      return result(['Date', 'Product', 'Direction', 'Quantity', 'Remaining', 'Reason', 'Disposition'],
        store.getStockMovements().filter(row => matches(row.movement_date))
          .map(row => [day(row.movement_date), row.product_name, row.type, row.quantity, row.remaining_stock, row.reason ?? '', row.disposition ?? '']));
    case 'purchases':
      return result(['Date', 'Supplier', 'Purchase ID', 'Invoice', 'Currency', 'RWF per currency unit in millionths', 'Total (RWF)'],
        store.getPurchases().filter(row => matches(row.purchase_date)).map(row => [day(row.purchase_date), row.supplier_name,
          row.id, row.invoice_reference ?? '', row.currency ?? 'RWF', row.rate_micros ?? 1000000, row.total_amount]));
    case 'suppliers':
      return result(['Supplier', 'Purchase ID', 'Outstanding (RWF)'],
        store.getPurchases().filter(row => row.balance > 0).map(row => [row.supplier_name, row.id, row.balance]), 'Current snapshot');
    case 'shipments':
      return result(['Date', 'Shipment', 'Agent', 'Status', 'Charges (RWF)', 'Paid (RWF)', 'Capitalized landed cost (RWF)'],
        store.getShipments().filter(row => matches(row.created_at)).map(row =>
          [day(row.created_at), row.reference, row.agent, row.status, row.expenses, row.paid, row.landed_cost]));
    case 'receiving':
      return result(['Date', 'Shipment', 'Receipt', 'Product', 'Expected', 'Received', 'Usable', 'Damaged', 'Missing', 'Capitalized (RWF)', 'Uncapitalized (RWF)', 'Explanation'],
        store.getShipments().flatMap(shipment => [
          ...shipment.events.filter(event => matches(event.recorded_at)).flatMap(event => event.lines.map(line => {
            const plan = shipment.lines.find(row => row.purchase_item_id === line.item_id);
            return [day(event.recorded_at), shipment.reference, event.reference, plan?.product_name ?? line.item_id,
              plan?.expected ?? '', line.usable + line.damaged, line.usable, line.damaged, line.missing,
              line.supplier_cost + line.capitalized_expense, line.damaged_supplier_cost + line.allocated_expense - line.capitalized_expense, line.explanation];
          })),
          ...shipment.legacy_receipts.filter(row => matches(row.recorded_at)).map(row => [day(row.recorded_at), shipment.reference,
            'Legacy receipt', row.product_name, '', row.quantity, row.quantity, 0, 0, row.landed_cost, 0, '']),
        ]));
    case 'reconciliation':
      return result(['Shipment', 'Product', 'Supplier', 'Expected', 'Received', 'Usable', 'Damaged', 'Missing', 'Outstanding'],
        store.getShipments().flatMap(shipment => shipment.lines.map(line =>
          [shipment.reference, line.product_name, line.supplier_name, line.expected,
            line.usable + line.damaged, line.usable, line.damaged, line.missing, line.outstanding])), 'Current manifest snapshot');
    case 'receivables':
      return result(['Customer', 'Sale ID', 'Outstanding (RWF)'],
        store.getSales().filter(row => row.balance > 0).map(row => [row.customer_name ?? 'Unassigned', row.id, row.balance]), 'Current snapshot');
    case 'accounts':
      return result(['Account', 'Type', 'Balance (RWF)'],
        store.getAccountBalances().filter(row => row.currency === 'RWF').map(row => [row.name, row.kind, row.balance]), 'Current RWF account snapshot');
    case 'native-accounts':
      return result(['Account', 'Type', 'Currency', 'Native balance', 'Status'],
        store.getAccountBalances().map(row => [row.name, row.kind, row.currency, formatNative(row.balance, row.currency), row.active ? 'Active' : 'Disabled']), 'Current snapshot');
    case 'expenses': {
      const allDates = query.get('range') === 'all';
      const filters = expenseFilters.parse({ ...Object.fromEntries(query),
        start: period.start ?? (!period.end && !allDates ? month + '-01' : undefined), end: period.end });
      const expenses = store.getExpenses(filters, true);
      const scope = [allDates && !period.start && !period.end ? 'All dates (Kigali)' : periodLabel,
        filters.category, filters.account ? store.getAccounts().find(account => account.id === filters.account)?.name : ''].filter(Boolean).join(' · ');
      return { title: reportTitles.expenses, scope, columns: ['Date','Category','Description','Account','Native amount','Reference','Status','Amount (RWF)'],
        rows: expenses.rows.map(row => [day(row.effective_at), row.category, row.reversal_reason || row.details?.description || '',
          row.account ?? '', formatNative(row.native_amount,row.currency), row.details?.receipt || row.reference,
          row.status,row.amount]), totals: { amount: expenses.totals.amount, groups: expenses.groups } };
    }
    case 'shipment-finance':
      return result(['Date', 'Action', 'Reference', 'Notes', 'Amount (RWF)'],
        store.getFinance().transactions.filter(row => /^(credit|cash|loss)(_reversal)?$/.test(row.kind) && matches(row.recorded_at))
          .map(row => [day(row.recorded_at), row.kind, row.reference, row.category ?? '', row.amount]));
    case 'currency-finance': {
      const finance = store.getFinance();
      const accounts = new Map(finance.accounts.map(row => [row.id, row]));
      return result(['Date', 'Reference', 'Action', 'Source', 'Destination', 'Captured rate (millionths)',
        'RWF equivalent (RWF)', 'Payable released (RWF)', 'FX loss or gain (RWF)'],
        finance.transactions.filter(row => (row.kind === 'exchange' || (row.currency && row.currency !== 'RWF') || row.fx_difference !== 0) && matches(row.recorded_at))
          .map(row => {
            const source = accounts.get(row.from_account ?? '');
            const destination = accounts.get(row.to_account ?? '');
            return [day(row.recorded_at), row.reference, row.kind,
              source && row.source_minor !== null ? `${source.name} · ${formatNative(row.source_minor, source.currency)}` : '',
              destination && row.destination_minor !== null ? `${destination.name} · ${formatNative(row.destination_minor, destination.currency)}` : '',
              row.rate ?? '', row.amount, row.payable_amount ?? '', row.fx_difference];
          }));
    }
    case 'products':
      return result(['Product', 'Net units', 'Net sales (RWF)'], store.getReports(period).monthly.best_selling_products
        .map(row => [row.product, row.units, row.revenue]));
    case 'channels':
      return result(['Channel', 'Net sales (RWF)'], store.getReports(period).monthly.channels.map(row => [row.channel, row.revenue]));
    case 'profitability': {
      const { monthly: summary } = store.getReports(period);
      return result(['Metric', 'Amount (RWF)'], [
        ['Net sales', summary.revenue], ['Cost of goods sold', summary.revenue - summary.profit],
        ['Gross profit', summary.profit], ['Operating expenses', summary.expenses],
        ['Profit after operating expenses', summary.profit - summary.expenses],
        ['Recognized shipment losses', summary.shipment_losses],
        ['Realized exchange loss (gain if negative)', summary.fx_difference],
      ]);
    }
  }
}
