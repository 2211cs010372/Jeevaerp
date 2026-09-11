import { headers } from "next/headers";
import { PortalShell } from "@/components/portal/shell/portal-shell";
import { portalDenied } from "@/lib/auth/portal-guard";

/**
 * The sign-in screen renders on top of the layout - no sidebar, no topbar.
 * The middleware forwards the resolved route as `x-portal-path`, so we can tell
 * a login render from an app render server-side (client usePathname is unreliable
 * for rewritten paths). Login → bare children; everything else → the portal shell.
 */
export default async function PharmacyLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-portal-path") ?? "";
  const isLogin = path.endsWith("/login");
  const isMobileScan = path.includes("/mobile-scan/");
  // Only PHARMACIST and ADMIN get past here. Checked before the print branch
  // below: a print sheet renders without the shell, not without a session.
  // Mobile-scan is opened on the pharmacist's phone via QR — no session needed.
  if (!isLogin && !isMobileScan) {
    const denied = await portalDenied("pharmacy", "Pharmacy");
    if (denied) return denied;
  }
  // Login, print, and mobile-scan render bare — no sidebar/topbar.
  if (isLogin || path.includes("/print/") || isMobileScan) return <>{children}</>;
  return (
    <PortalShell portalKey="pharmacy" userName="Pharmacy User" title="Pharmacy">
      {children}
    </PortalShell>
  );
}
