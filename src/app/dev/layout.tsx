import type { Metadata } from "next";
import { headers } from "next/headers";
import { PortalShell } from "@/components/portal/shell/portal-shell";
import { portalDenied } from "@/lib/auth/portal-guard";

export const metadata: Metadata = { title: "Developer" };

/**
 * The developer's portal.
 *
 * It was one screen - the launcher - and deliberately had no shell around it: a
 * sidebar listing a single item, next to a page that is itself the nav, is a
 * sidebar for nothing. That stopped being true when login activity, the audit
 * log and the crash list moved here out of the admin console. Four screens is a
 * portal, so it wears the same shell every other portal wears, and the sidebar
 * is how you get from a stack trace back to the launcher.
 *
 * The role gate is the same one every other portal uses, so this portal cannot
 * drift from the access model: SUPERUSER and ADMIN, checked in the layout as
 * well as the middleware. See lib/auth/portals.ts.
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
    <PortalShell portalKey="dev" userName="Developer" title="Developer">
      {children}
    </PortalShell>
  );
}
