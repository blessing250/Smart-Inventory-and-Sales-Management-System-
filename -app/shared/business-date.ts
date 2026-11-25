const kigaliDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Kigali' });

export function businessDate(value: Date | string) {
  return kigaliDate.format(new Date(value));
}

export function businessPeriod(period: { start?: string; end?: string }, defaultMonth: string) {
  return (timestamp: string) => {
    const date = businessDate(timestamp);
    return period.start || period.end
      ? (!period.start || date >= period.start) && (!period.end || date <= period.end)
      : date.startsWith(defaultMonth);
  };
}
