import type { Metadata } from "next";
import { headers } from "next/headers";
import { portalDenied } from "@/lib/auth/portal-guard";

export const metadata: Metadata = { title: "Developer" };

/**
 * The developer's portal.
 *
 * Deliberately NOT wrapped in PortalShell, unlike every other portal. The shell
 * exists to give a desk a sidebar of the screens inside its own portal, and
 * this portal has exactly one screen - the launcher - whose entire content is
 * links OUT of it. A sidebar here would be a nav listing one item next to a
 * page that is itself the nav.
 *
 * The role gate is the same one every other portal uses, so this portal cannot
 * drift from the access model: ADMIN only, checked in the layout as well as the
 * middleware. See lib/auth/portals.ts.
 */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-portal-path") ?? "";
  const isLogin = path.endsWith("/login");

  if (!isLogin) {
    const denied = await portalDenied("dev", "Developer");
    if (denied) return denied;
  }
  // The sign-in screen paints its own full-viewport background.
  if (isLogin) return <>{children}</>;

  return (
    <div className="portal min-h-screen" data-portal="dev">
      {children}
    </div>
  );
}
