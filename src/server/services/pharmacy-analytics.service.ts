import { prisma } from "@/lib/prisma";

export interface StockPredictionItem {
  id: string;
  name: string;
  currentStock: number;
  reorderThreshold: number;
  soldLast30Days: number;
  dailyVelocity: number;
  daysRemaining: number | null;
  suggestedPoQty: number;
  status: "CRITICAL" | "LOW" | "ADEQUATE" | "OVERSTOCKED";
}

export interface ExpiryRiskItem {
  id: string;
  medicineName: string;
  batchNo: string;
  expiryDate: string;
  daysUntilExpiry: number;
  stockQty: number;
  purchasePrice: number;
  riskAmount: number;
  action: "RETURN_TO_VENDOR" | "APPLY_DISCOUNT" | "MONITOR";
}

export interface PharmacyAnalyticsSummary {
  totalMedicines: number;
  criticalReorderCount: number;
  totalExpiryRiskValue: number;
  expiryIn30DaysCount: number;
  predictions: StockPredictionItem[];
  expiringBatches: ExpiryRiskItem[];
}

export async function getPharmacyAnalytics(): Promise<PharmacyAnalyticsSummary> {
  const medicines = await prisma.medicine.findMany({
    select: {
      id: true,
      name: true,
      reorderThreshold: true,
      batches: {
        select: {
          quantity: true,
        },
      },
    },
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get sales velocity over last 30 days from StockTransaction (DISPENSE movements)
  const transactions = await prisma.stockTransaction.findMany({
    where: {
      type: "DISPENSE",
      createdAt: { gte: thirtyDaysAgo },
    },
    include: {
      batch: { select: { medicineId: true } },
    },
  });

  const salesMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.batch?.medicineId) {
      const current = salesMap.get(t.batch.medicineId) || 0;
      salesMap.set(t.batch.medicineId, current + Math.abs(t.qty || 0));
    }
  }

  const predictions: StockPredictionItem[] = medicines.map((m) => {
    const currentStock = m.batches.reduce((acc, b) => acc + (b.quantity || 0), 0);
    const reorderThreshold = m.reorderThreshold || 10;
    const sold30 = salesMap.get(m.id) || 0;
    const dailyVel = parseFloat((sold30 / 30).toFixed(2));

    let daysRemaining: number | null = null;
    if (dailyVel > 0) {
      daysRemaining = Math.round(currentStock / dailyVel);
    }

    let status: StockPredictionItem["status"] = "ADEQUATE";
    if (currentStock === 0 || (daysRemaining !== null && daysRemaining <= 3)) {
      status = "CRITICAL";
    } else if (currentStock <= reorderThreshold || (daysRemaining !== null && daysRemaining <= 7)) {
      status = "LOW";
    } else if (daysRemaining !== null && daysRemaining > 90) {
      status = "OVERSTOCKED";
    }

    let suggestedPoQty = 0;
    if (status === "CRITICAL" || status === "LOW") {
      const targetStock = Math.max(reorderThreshold * 2, Math.ceil(dailyVel * 30));
      suggestedPoQty = Math.max(targetStock - currentStock, 20);
    }

    return {
      id: m.id,
      name: m.name,
      currentStock,
      reorderThreshold,
      soldLast30Days: sold30,
      dailyVelocity: dailyVel,
      daysRemaining,
      suggestedPoQty,
      status,
    };
  });

  // Query StockBatch for expiry risk
  const batches = await prisma.stockBatch.findMany({
    where: {
      quantity: { gt: 0 },
    },
    include: {
      medicine: { select: { name: true } },
    },
    orderBy: { expiryDate: "asc" },
  });

  const now = new Date();
  const expiringBatches: ExpiryRiskItem[] = [];
  let totalExpiryRiskValue = 0;
  let expiryIn30DaysCount = 0;

  for (const b of batches) {
    const exp = new Date(b.expiryDate);
    const diffTime = exp.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 90) {
      const price = b.purchasePrice ? Number(b.purchasePrice) : Number(b.mrp || 0);
      const riskAmt = parseFloat((b.quantity * price).toFixed(2));
      totalExpiryRiskValue += riskAmt;

      if (diffDays <= 30) {
        expiryIn30DaysCount++;
      }

      let action: ExpiryRiskItem["action"] = "MONITOR";
      if (diffDays <= 30) {
        action = "RETURN_TO_VENDOR";
      } else if (diffDays <= 60) {
        action = "APPLY_DISCOUNT";
      }

      expiringBatches.push({
        id: b.id,
        medicineName: b.medicine?.name || "Unknown Medicine",
        batchNo: b.batchNo,
        expiryDate: b.expiryDate.toISOString().split("T")[0],
        daysUntilExpiry: diffDays,
        stockQty: b.quantity,
        purchasePrice: price,
        riskAmount: riskAmt,
        action,
      });
    }
  }

  const criticalReorderCount = predictions.filter(
    (p) => p.status === "CRITICAL" || p.status === "LOW"
  ).length;

  return {
    totalMedicines: medicines.length,
    criticalReorderCount,
    totalExpiryRiskValue: parseFloat(totalExpiryRiskValue.toFixed(2)),
    expiryIn30DaysCount,
    predictions: predictions.sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999)),
    expiringBatches,
  };
}
