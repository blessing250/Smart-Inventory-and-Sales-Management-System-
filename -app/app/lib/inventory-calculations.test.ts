import { describe, expect, it } from 'vitest';
import {
  calculateProfit,
  calculateSaleSubtotal,
  calculateStockIn,
  calculateStockOut,
} from './inventory-calculations';

describe('inventory calculations', () => {
  it('calculates profit from revenue and expenses', () => {
    expect(calculateProfit(500000, 300000)).toBe(200000);
  });

  it('adds stock when products arrive', () => {
    expect(calculateStockIn(50, 100)).toBe(150);
  });

  it('removes stock when products are sold', () => {
    expect(calculateStockOut(50, 5)).toBe(45);
  });

  it('prevents stock from going below zero', () => {
    expect(() => calculateStockOut(3, 5)).toThrow('Sold quantity cannot be greater than current stock.');
  });

  it('calculates sale subtotals', () => {
    expect(calculateSaleSubtotal(5, 1500)).toBe(7500);
  });
});
