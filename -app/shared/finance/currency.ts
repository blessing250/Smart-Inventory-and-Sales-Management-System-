const formatter = new Intl.NumberFormat('en-RW', { maximumFractionDigits: 0 });

export function formatRwf(amount: number) {
  return `RWF ${formatter.format(amount)}`;
}
