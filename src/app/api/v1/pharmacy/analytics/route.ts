import { NextRequest, NextResponse } from "next/server";
import { getPharmacyAnalytics } from "@/server/services/pharmacy-analytics.service";

export async function GET(req: NextRequest) {
  try {
    const data = await getPharmacyAnalytics();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Pharmacy analytics endpoint error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to calculate pharmacy analytics" },
      { status: 500 }
    );
  }
}
