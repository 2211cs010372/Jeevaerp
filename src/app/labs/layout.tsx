import { headers } from "next/headers";
import { PortalShell } from "@/components/portal/shell/portal-shell";

/**
 * The sign-in screen renders on top of the layout - no sidebar, no topbar.
 * The middleware forwards the resolved route as `x-portal-path`, so we can tell
 * a login render from an app render server-side (client usePathname is unreliable
 * for rewritten paths). Login → bare children; everything else → the portal shell.
 */
export default async function LabsLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-portal-path") ?? "";
  // Login and print pages render bare - no sidebar/topbar. Print especially:
  // the sheet must flow in normal document order so a long A5 bill can paginate.
  if (path.endsWith("/login") || path.includes("/print/")) return <>{children}</>;
  return (
    <PortalShell portalKey="labs" userName="Labs User" title="Labs">
      {children}
    </PortalShell>
  );
}
