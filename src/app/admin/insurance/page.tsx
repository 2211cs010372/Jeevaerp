"use client";

import { ClaimsBoard } from "@/components/portal/insurance/claims-board";

/**
 * The proprietor's view of the claims book. Identical screen to the one the
 * insurance desk works from - see ClaimsBoard for why it is one component - but
 * reached through the admin console and served by the admin API.
 */
export default function AdminInsurancePage() {
  return <ClaimsBoard apiBase="/admin/insurance" />;
}
