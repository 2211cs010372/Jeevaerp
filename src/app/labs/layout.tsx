import { headers } from "next/headers";
import { PortalShell } from "@/components/portal/shell/portal-shell";
import { portalDenied } from "@/lib/auth/portal-guard";

/**
 * The sign-in screen renders on top of the layout - no sidebar, no topbar.
 * The middleware forwards the resolved route as `x-portal-path`, so we can tell
 * a login render from an app render server-side (client usePathname is unreliable
 * for rewritten paths). Login → bare children; everything else → the portal shell.
 */
export default async function LabsLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-portal-path") ?? "";
  const isLogin = path.endsWith("/login");
  // Only LAB_TECH and ADMIN get past here. Checked before the print branch
  // below: a print sheet renders without the shell, not without a session.
  if (!isLogin) {
    const denied = await portalDenied("labs", "Labs");
    if (denied) return denied;
  }
  // Login and print pages render bare - no sidebar/topbar. Print especially:
  // the sheet must flow in normal document order so a long A5 bill can paginate.
  if (isLogin || path.includes("/print/")) return <>{children}</>;
  return (
    <PortalShell portalKey="labs" userName="Labs User" title="Labs">
      {children}
    </PortalShell>
  );
}
