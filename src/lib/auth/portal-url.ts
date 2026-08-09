import { classifyHost, type PORTAL_SUBDOMAINS } from "@/lib/auth/host";

type Portal = (typeof PORTAL_SUBDOMAINS)[number];

/**
 * A LINK FROM ONE PORTAL TO ANOTHER.
 *
 * The portals are separate origins in the shape this app is normally deployed
 * in - `reception.jeeva.com` and `insurance.jeeva.com` are different hosts - so
 * a plain `<Link href="/admissions/x">` from reception lands on
 * `reception.jeeva.com/admissions/x`, which does not exist. That is why there
 * were no cross-portal links anywhere: the obvious way to write one is broken,
 * and the non-obvious way had to be written first.
 *
 * Routing shape is decided by the same `classifyHost` the middleware enforces,
 * so a link built here can never disagree with what the server will accept:
 *
 *   subdomain mode → https://insurance.jeeva.com/admissions/x
 *   path mode      → /insurance/admissions/x     (*.vercel.app, bare IP)
 *
 * `COOKIE_DOMAIN` is a server env var and is not readable here. Leaving it out
 * is safe: it only ever FORCES subdomain mode, and every host that would need
 * forcing - a real custom domain, localhost - already classifies that way on
 * its own. The one case it changes is a deployment that sets COOKIE_DOMAIN on a
 * host that would otherwise be path-routed, which is not a shape this app is
 * deployed in.
 *
 * Server-side, use `resolveOrigin` instead - it has the request and the env.
 */
export function portalUrl(portal: Portal, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  // SSR and tests have no window. A path-prefixed URL is the safe answer: it
  // works in path mode outright, and in subdomain mode the middleware redirects
  // `/insurance/...` on the insurance host back to `/...` rather than 404ing.
  if (typeof window === "undefined") return `/${portal}${p}`;

  const { subdomainMode, rootDomain, port } = classifyHost(window.location.host);
  if (!subdomainMode || !rootDomain) return `/${portal}${p}`;

  return `${window.location.protocol}//${portal}.${rootDomain}${port ? `:${port}` : ""}${p}`;
}
