import type { Role } from "@/lib/auth/types";
import { classifyHost } from "@/lib/auth/host";

/**
 * The ONE place that maps a role to where it lives. Used by:
 *   - login responses (tell the client where to go)
 *   - middleware (enforce which roles may load which subdomain)
 *   - portal layouts (server-side guard)
 * Change routing here and it changes everywhere, consistently.
 */

/** Subdomain slug per role. `null` = the main/public domain (patients). */
export const ROLE_SUBDOMAIN: Record<Role, string | null> = {
  ADMIN: "admin",
  RECEPTIONIST: "reception",
  DOCTOR: "doctor",
  LAB_TECH: "labs",
  PHARMACIST: "pharmacy",
  PATIENT: null,
};

/** Landing path within that portal, immediately after login. */
export const ROLE_HOME_PATH: Record<Role, string> = {
  ADMIN: "/",
  RECEPTIONIST: "/",
  DOCTOR: "/",
  LAB_TECH: "/",
  PHARMACIST: "/",
  PATIENT: "/portal/profile",
};

const PORTAL_SUBDOMAINS = ["admin", "reception", "doctor", "labs", "pharmacy"] as const;
export type PortalSubdomain = (typeof PORTAL_SUBDOMAINS)[number];

/**
 * Which roles are permitted on a given portal.
 *
 * ADMIN is on every list and every other role appears on exactly one: the
 * proprietor oversees the whole hospital from any desk, while a receptionist,
 * doctor, technician or pharmacist only ever belongs in their own portal. That
 * asymmetry is the whole access model - keep it here and nowhere else.
 */
export const SUBDOMAIN_ALLOWED_ROLES: Record<PortalSubdomain, Role[]> = {
  admin: ["ADMIN"],
  reception: ["RECEPTIONIST", "ADMIN"], // admin can oversee the front desk
  doctor: ["DOCTOR", "ADMIN"],
  labs: ["LAB_TECH", "ADMIN"],
  pharmacy: ["PHARMACIST", "ADMIN"],
};

export function isPortalSubdomain(sub: string): sub is PortalSubdomain {
  return (PORTAL_SUBDOMAINS as readonly string[]).includes(sub);
}

/** May this role work in this portal? The one predicate every gate asks. */
export function roleAllowedOnPortal(role: Role, portal: PortalSubdomain): boolean {
  return SUBDOMAIN_ALLOWED_ROLES[portal].includes(role);
}

/** Human name for a portal, for messages staff actually read. */
export const PORTAL_LABEL: Record<PortalSubdomain, string> = {
  admin: "Admin",
  reception: "Reception",
  doctor: "Doctor",
  labs: "Labs",
  pharmacy: "Pharmacy",
};

/**
 * Which portal a request came from, so a sign-in can be judged against it.
 *
 * Two shapes, matching classifyHost:
 *   • subdomain mode - the portal IS the host's first label (doctor.jeeva.com),
 *     and the API is same-origin on each portal, so the host is authoritative.
 *   • path mode      - one host serves every portal, so the only signal is the
 *     page the form was served from: the referer's first path segment.
 *
 * Returns null when neither says a portal (a direct API call, a stripped
 * referer). Callers must treat null as "no portal context" and fall back to the
 * role's own portal - this resolves where a login was ATTEMPTED, which is a
 * question about intent, not a security boundary. What actually confines a
 * session is the middleware plus each portal layout, both of which re-check the
 * role against the portal being loaded.
 *
 * Takes plain header values rather than a NextRequest so it stays pure and
 * edge-safe, like everything else in this file.
 */
export function portalFromRequest(
  h: { host?: string | null; referer?: string | null },
  cookieDomain?: string,
): PortalSubdomain | null {
  const { subdomainMode, sub } = classifyHost(h.host ?? "", cookieDomain);
  if (subdomainMode && isPortalSubdomain(sub)) return sub;

  if (!h.referer) return null;
  let path: string;
  try {
    path = new URL(h.referer).pathname;
  } catch {
    return null;
  }
  const first = path.split("/").filter(Boolean)[0];
  return first && isPortalSubdomain(first) ? first : null;
}

/**
 * Absolute post-login destination for a role.
 *
 * In production every portal is a real subdomain (admin.jeeva…com).
 * In local dev we use `admin.localhost:PORT` - which modern browsers resolve
 * with no hosts-file editing. When no root domain is configured we fall back
 * to a path prefix (/admin) so the app still works on a single host.
 */
export function destinationFor(
  role: Role,
  opts: { rootDomain?: string; protocol?: string; port?: string } = {}
): string {
  const sub = ROLE_SUBDOMAIN[role];
  const path = ROLE_HOME_PATH[role];

  // Patients (and anything with no subdomain) stay on the current host.
  if (!sub) return path;

  const { rootDomain, protocol = "https", port } = opts;

  // No root domain known -> single-host fallback via path prefix.
  if (!rootDomain) return `/${sub}${path === "/" ? "" : path}`;

  const portSuffix = port ? `:${port}` : "";
  return `${protocol}://${sub}.${rootDomain}${portSuffix}${path}`;
}
