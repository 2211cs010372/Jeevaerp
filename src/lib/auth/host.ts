/**
 * ONE classifier for how a given request host should route portals - shared by
 * the middleware (which enforces it) and resolveOrigin (which builds post-login
 * redirect URLs), so the two can never disagree. Pure string work → edge-safe.
 *
 * Two routing shapes:
 *   • subdomain - admin.example.com → /admin        (real domains, localhost)
 *   • path      - example.com/admin                 (*.vercel.app, bare IPs)
 *
 * Subdomain routing needs wildcard subdomains that actually resolve + carry a
 * TLS cert. That's true for a real custom domain and for *.localhost, but NOT
 * for a bare *.vercel.app (admin.<proj>.vercel.app has no cert). An explicit
 * COOKIE_DOMAIN always forces subdomain mode.
 */
/**
 * Every portal subdomain, defined HERE because this is the lowest-level module
 * that needs it - portals.ts imports classifyHost, so the list cannot live there
 * without a cycle. `portals.ts` re-exports it, and the middleware reads it from
 * there, so there is exactly one copy in the codebase.
 *
 * There used to be three. The insurance portal was added to two of them and the
 * third - this one - silently made `insurance.jeeva.com` its own root domain,
 * which breaks the post-login redirect and scopes the session cookie to the
 * wrong host. Nothing fails loudly; the desk just cannot stay signed in.
 */
/// `dev` is the developer's launcher - ADMIN-only, and a portal in its own
/// right rather than a page inside admin, so that whoever is maintaining the
/// system has a desk that is not somebody's job. It carries no hospital data of
/// its own; see src/app/dev.
export const PORTAL_SUBDOMAINS = ["admin", "reception", "doctor", "labs", "pharmacy", "insurance", "dev"] as const;

export interface HostRouting {
  /** true → admin.host routing; false → /admin path routing. */
  subdomainMode: boolean;
  /** Registrable root for building subdomain URLs (undefined in path mode). */
  rootDomain?: string;
  /** First hostname label (the candidate portal subdomain). */
  sub: string;
  /** Port, when present on the host header. */
  port?: string;
}

export function classifyHost(host: string, cookieDomain?: string): HostRouting {
  const [hostname, port] = (host || "").split(":");
  const labels = hostname.split(".");
  const sub = labels[0] ?? "";

  // Explicit config wins - ".root.com" → "root.com".
  const configured = cookieDomain?.replace(/^\./, "");
  if (configured) return { subdomainMode: true, rootDomain: configured, sub, port };

  // Local dev: modern browsers resolve admin.localhost with no hosts edit.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { subdomainMode: true, rootDomain: "localhost", sub, port };
  }

  // *.vercel.app (no wildcard cert), bare IP, or single-label → path routing.
  const isIp = /^\d+$/.test(labels[labels.length - 1]);
  if (hostname.endsWith(".vercel.app") || labels.length < 2 || isIp) {
    return { subdomainMode: false, sub, port };
  }

  // Real custom domain → subdomain routing. Strip a leading portal/www label
  // to get the registrable root (admin.jeeva.com & www.jeeva.com → jeeva.com).
  const hasSubPrefix = labels.length > 2 && ((PORTAL_SUBDOMAINS as readonly string[]).includes(sub) || sub === "www");
  const rootDomain = hasSubPrefix ? labels.slice(1).join(".") : hostname;
  return { subdomainMode: true, rootDomain, sub, port };
}
