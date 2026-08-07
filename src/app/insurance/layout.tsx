import { headers } from "next/headers";
import { PortalShell } from "@/components/portal/shell/portal-shell";
import { portalDenied } from "@/lib/auth/portal-guard";

/**
 * The insurance room. Same shape as every other portal layout: login renders
 * bare, everything else renders inside the shell and only after the role gate.
 */
export default async function InsuranceLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-portal-path") ?? "";
  const isLogin = path.endsWith("/login");
  // Only INSURANCE_DESK and ADMIN get past here.
  if (!isLogin) {
    const denied = await portalDenied("insurance", "Insurance");
    if (denied) return denied;
  }
  if (isLogin || path.includes("/print/")) return <>{children}</>;
  return (
    <PortalShell portalKey="insurance" userName="Insurance Desk" title="Insurance">
      {children}
    </PortalShell>
  );
}
