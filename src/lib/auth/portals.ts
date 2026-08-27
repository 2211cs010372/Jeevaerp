import type { Role } from "@/lib/auth/types";
import { classifyHost, PORTAL_SUBDOMAINS } from "@/lib/auth/host";

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
  INSURANCE_DESK: "insurance",
  // The developers land on their own launcher, not on the admin console. It is
  // the one portal whose entire content is doors into the others, which is what
  // somebody debugging the building wants in front of them first.
  SUPERUSER: "dev",
  PATIENT: null,
};

/** Landing path within that portal, immediately after login. */
export const ROLE_HOME_PATH: Record<Role, string> = {
  ADMIN: "/",
  RECEPTIONIST: "/",
  DOCTOR: "/",
  LAB_TECH: "/",
  PHARMACIST: "/",
  INSURANCE_DESK: "/",
  SUPERUSER: "/",
  PATIENT: "/portal/profile",
};

/** Re-exported so the middleware routes off one list rather than its own copy -
 *  a copy is how a new portal ends up working on its subdomain and 404ing on the
 *  single-host path fallback. Defined in host.ts; see the note there. */
export { PORTAL_SUBDOMAINS };
export type PortalSubdomain = (typeof PORTAL_SUBDOMAINS)[number];

/**
 * Which roles are permitted on a given portal.
 *
 * ADMIN and SUPERUSER are on every list and every other role appears on exactly
 * one: the proprietor oversees the whole hospital from any desk, the developer
 * has to be able to reproduce whatever a desk is complaining about, and a
 * receptionist, doctor, technician or pharmacist only ever belongs in their own
 * portal. That asymmetry is the whole access model - keep it here, nowhere else.
 *
 * The two all-access roles are not interchangeable. ADMIN runs the hospital and
 * appears wherever staff appear; SUPERUSER maintains the software and appears
 * nowhere in the admin console (see listStaff in admin.service.ts). Same doors,
 * different person - which is the point, because until now the audit log could
 * not tell a developer's data fix from a proprietor's decision.
 */
export const SUBDOMAIN_ALLOWED_ROLES: Record<PortalSubdomain, Role[]> = {
  admin: ["ADMIN", "SUPERUSER"],
  reception: ["RECEPTIONIST", "ADMIN", "SUPERUSER"], // admin can oversee the front desk
  doctor: ["DOCTOR", "ADMIN", "SUPERUSER"],
  labs: ["LAB_TECH", "ADMIN", "SUPERUSER"],
  pharmacy: ["PHARMACIST", "ADMIN", "SUPERUSER"],
  insurance: ["INSURANCE_DESK", "ADMIN", "SUPERUSER"],
  // The developer's launcher, and now SUPERUSER's home. ADMIN stays on the list
  // rather than being quietly locked out of a portal it could already reach:
  // narrowing the proprietor's access is a decision of its own, not a side
  // effect of giving the developers a role.
  dev: ["SUPERUSER", "ADMIN"],
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
  insurance: "Insurance",
  dev: "Developer",
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

/**
 * Where a sign-in should LAND, given the portal it was attempted at.
 *
 * `destinationFor` above answers a different question - "where does this role
 * belong" - which is right for a session check and wrong for a login. ADMIN is
 * allowed on every portal, so an admin who opened `dev.jeeva.com/login` and
 * typed their password was carried off to the admin console: the one portal
 * they did not ask for. Landing them where they signed in is the honest answer,
 * and it is the only way a portal that is not any role's HOME can be reached at
 * all.
 *
 * This cannot widen access. A role that is not permitted on the portal never
 * reaches this function - `assertPortalLogin` has already refused the login -
 * and the check is repeated here rather than assumed. No portal context (a
 * direct API call with no host or referer) falls back to the role's own portal,
 * exactly as before.
 */
export function destinationForLogin(
  role: Role,
  portal: PortalSubdomain | null,
  opts: { rootDomain?: string; protocol?: string; port?: string } = {},
): string {
  // No context, their own portal anyway, or not allowed here → the old answer.
  // The middle case matters: only `destinationFor` knows ROLE_HOME_PATH, which
  // is how a PATIENT lands on /portal/profile rather than a bare "/".
  if (!portal || portal === ROLE_SUBDOMAIN[role] || !roleAllowedOnPortal(role, portal)) {
    return destinationFor(role, opts);
  }

  const { rootDomain, protocol = "https", port } = opts;
  if (!rootDomain) return `/${portal}`;
  return `${protocol}://${portal}.${rootDomain}${port ? `:${port}` : ""}/`;
}
