export function roundedShare(amount: number, numerator: number, denominator: number) {
  const divisor = BigInt(denominator);
  return Number((BigInt(amount) * BigInt(numerator) + divisor / BigInt(2)) / divisor);
}

export function allocateCost(amount: number, weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let previous = 0;
  let cumulative = 0;
  return weights.map(weight => {
    cumulative += weight;
    const next = roundedShare(amount, cumulative, total);
    const allocated = next - previous;
    previous = next;
    return allocated;
  });
}
