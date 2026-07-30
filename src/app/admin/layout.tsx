import { headers } from "next/headers";
import { PortalShell } from "@/components/portal/shell/portal-shell";
import { getHiddenAdminNavHrefs } from "@/server/services/admin.service";
import { portalDenied } from "@/lib/auth/portal-guard";

/**
 * The sign-in screen renders on top of the layout - no sidebar, no topbar.
 * The middleware forwards the resolved route as `x-portal-path`, so we can tell
 * a login render from an app render server-side (client usePathname is unreliable
 * for rewritten paths). Login → bare children; everything else → the portal shell.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-portal-path") ?? "";
  const isLogin = path.endsWith("/login");
  // ADMIN only - the one portal no other role may enter. Checked before the
  // print branch below: a print sheet renders without the shell, not without a
  // session. Also before getHiddenAdminNavHrefs, so a stranger's request never
  // reaches the database.
  if (!isLogin) {
    const denied = await portalDenied("admin", "Admin");
    if (denied) return denied;
  }
  // Login and print pages render bare - no sidebar/topbar. Print especially:
  // the sheet must flow in normal document order so a long A5 bill can paginate.
  if (isLogin || path.includes("/print/")) return <>{children}</>;
  // Read here rather than in the shell so the sidebar is correct on first paint
  // - a client fetch would show the tab and then take it away again.
  const hiddenNavHrefs = await getHiddenAdminNavHrefs();
  return (
    <PortalShell portalKey="admin" userName="Admin User" title="Admin" hiddenNavHrefs={hiddenNavHrefs}>
      {children}
    </PortalShell>
  );
}
