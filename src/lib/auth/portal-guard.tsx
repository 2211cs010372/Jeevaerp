import { cookies } from "next/headers";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { ACCESS_COOKIE } from "@/lib/auth/session";
import { roleAllowedOnPortal, type PortalSubdomain } from "@/lib/auth/portals";
import { AuthScreen } from "@/components/portal/auth-screen";

/**
 * The portal layouts' own role gate - the second lock on every staff portal.
 *
 * The middleware is the first: it verifies the session's role against
 * SUBDOMAIN_ALLOWED_ROLES before a portal route is ever rewritten. But it runs
 * behind a path matcher (`/((?!_next|favicon.ico|.*\..*).*)`), so it is one
 * config edit away from not running on some request shape, and it is the ONLY
 * thing standing between a signed-in receptionist and the doctor portal's
 * pages. A guard in the layout cannot be routed around: nothing in a portal
 * renders without its layout rendering first.
 *
 * Only ADMIN clears more than one portal. Everyone else gets that portal's
 * sign-in screen - RETURNED, not redirected to. Two reasons:
 *
 *  - it matches the middleware, which rewrites rather than redirects so the URL
 *    bar stays on the portal the person actually asked for;
 *  - redirecting to `/<portal>/login` would loop forever in exactly the
 *    scenario this guard exists for. If the middleware ever stops running, it
 *    also stops setting `x-portal-path`, so the layout can no longer tell a
 *    login render from an app render - and would bounce the login page to
 *    itself. Rendering the screen terminates whether or not anything upstream
 *    is working.
 *
 * Returns null when the caller is cleared; otherwise the element to render
 * instead of the portal.
 */
export async function portalDenied(
  portal: PortalSubdomain,
  portalName: string,
): Promise<React.ReactElement | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token) {
    try {
      const { role } = await verifyAccessToken(token);
      if (roleAllowedOnPortal(role, portal)) return null;
    } catch {
      // Expired or tampered - treated the same as no session at all.
    }
  }
  return <AuthScreen portalName={portalName} portalKey={portal} />;
}
