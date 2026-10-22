export function calculateProfit(revenue: number, expenses: number) {
  return revenue - expenses;
}

export function calculateStockIn(currentStock: number, addedQuantity: number) {
  return currentStock + addedQuantity;
}

export function calculateStockOut(currentStock: number, soldQuantity: number) {
  if (soldQuantity > currentStock) {
    throw new Error('Sold quantity cannot be greater than current stock.');
  }

  return currentStock - soldQuantity;
}

export function calculateSaleSubtotal(quantity: number, unitPrice: number) {
  return quantity * unitPrice;
}
