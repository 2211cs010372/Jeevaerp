import { describe, expect, it } from "vitest";

function calculateDaysRemaining(currentStock: number, sold30Days: number): number | null {
  if (sold30Days <= 0) return null;
  const dailyVelocity = sold30Days / 30;
  return Math.round(currentStock / dailyVelocity);
}

function calculateSuggestedPoQty(currentStock: number, reorderLevel: number, sold30Days: number): number {
  const dailyVelocity = sold30Days / 30;
  const daysRemaining = calculateDaysRemaining(currentStock, sold30Days);
  
  if (currentStock === 0 || currentStock <= reorderLevel || (daysRemaining !== null && daysRemaining <= 7)) {
    const targetStock = Math.max(reorderLevel * 2, Math.ceil(dailyVelocity * 30));
    return Math.max(targetStock - currentStock, 20);
  }
  return 0;
}

function determineExpiryAction(daysUntilExpiry: number): "RETURN_TO_VENDOR" | "APPLY_DISCOUNT" | "MONITOR" {
  if (daysUntilExpiry <= 30) return "RETURN_TO_VENDOR";
  if (daysUntilExpiry <= 60) return "APPLY_DISCOUNT";
  return "MONITOR";
}

describe("Smart Stock Expiry & Auto-Reorder Logic", () => {
  it("calculates stock velocity & days remaining correctly", () => {
    // 300 units sold in 30 days = 10 units/day. 50 units stock = 5 days remaining.
    expect(calculateDaysRemaining(50, 300)).toBe(5);
    // 0 sales = null days remaining
    expect(calculateDaysRemaining(50, 0)).toBeNull();
  });

  it("suggests optimal PO reorder quantity when stock is critical or low", () => {
    // 50 units stock, reorder level 100, sold 300 in 30 days -> suggested PO = 300 - 50 = 250
    expect(calculateSuggestedPoQty(50, 100, 300)).toBe(250);
    // Adequate stock -> suggested PO = 0
    expect(calculateSuggestedPoQty(500, 50, 300)).toBe(0);
  });

  it("determines correct expiry action based on days remaining", () => {
    expect(determineExpiryAction(15)).toBe("RETURN_TO_VENDOR");
    expect(determineExpiryAction(45)).toBe("APPLY_DISCOUNT");
    expect(determineExpiryAction(75)).toBe("MONITOR");
  });
});
