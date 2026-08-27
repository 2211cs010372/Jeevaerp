import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { readAccessToken } from "@/lib/auth/session";
import type { AuthUser, Role } from "@/lib/auth/types";
import { env } from "@/lib/env";
import {
  PORTAL_LABEL, ROLE_SUBDOMAIN, portalFromRequest, roleAllowedOnPortal,
  type PortalSubdomain,
} from "@/lib/auth/portals";

/** Verifies the access token (cookie or Bearer) and returns the caller. */
export async function requireAuth(req: NextRequest): Promise<AuthUser> {
  const token = readAccessToken(req);
  if (!token) throw new ApiError(401, "Not authenticated");
  try {
    const payload = await verifyAccessToken(token);
    return { id: payload.sub, role: payload.role };
  } catch {
    throw new ApiError(401, "Invalid or expired session");
  }
}

/**
 * Role gate for route handlers:
 *   const user = await requireRole(req, "RECEPTIONIST", "ADMIN");
 *
 * SUPERUSER clears every gate without being named in any of them. That wildcard
 * belongs HERE, in the one function every route handler already calls, and not
 * in their argument lists: adding "SUPERUSER" to every call site is that many
 * chances to miss one, and every route written afterwards would have to
 * remember. A developer who cannot open the screen they were asked to fix ends
 * up borrowing a real administrator's password - which is the precise outcome
 * this role exists to prevent, since the audit log records who acted.
 *
 * It is a wildcard over ROLES and nothing else. Whatever a handler checks after
 * this line - ownership, the portal it was called from, whether a bill is still
 * editable - is still asked, and still answered the same way.
 */
export async function requireRole(req: NextRequest, ...roles: Role[]): Promise<AuthUser> {
  const user = await requireAuth(req);
  if (user.role !== "SUPERUSER" && !roles.includes(user.role)) {
    throw new ApiError(403, "Insufficient permissions for this action");
  }
  return user;
}

/**
 * Refuse a sign-in that was attempted at the wrong portal.
 *
 * Without this a receptionist could type their credentials into the doctor
 * portal's login, be signed in, and then be redirected away to reception - a
 * successful login on a page they have no business using, which reads as a bug
 * to the person doing it and as a door to anyone probing. ADMIN and SUPERUSER
 * pass every portal by design; everyone else is turned away at the portal that
 * isn't theirs, and told which one is.
 *
 * `portal` is null for a login with no portal context (a direct API call). We
 * allow those: this check is about honest routing, and a caller who reaches the
 * endpoint directly still only ever receives their OWN role's session, which
 * the middleware and the portal layouts confine to their own portal.
 *
 * Returns the portal it cleared (null when there was no context) so the caller
 * can land the sign-in there rather than resolving the request twice. Throwing
 * is still the only way this function says no.
 */
export function assertPortalLogin(req: NextRequest, role: Role): PortalSubdomain | null {
  const portal = portalFromRequest(
    { host: req.headers.get("host"), referer: req.headers.get("referer") },
    env().COOKIE_DOMAIN,
  );
  if (!portal || roleAllowedOnPortal(role, portal)) return portal;

  const own = ROLE_SUBDOMAIN[role];
  const ownName = own ? PORTAL_LABEL[own as keyof typeof PORTAL_LABEL] : null;
  throw new ApiError(
    403,
    ownName
      ? `This is the ${PORTAL_LABEL[portal]} portal. Your account signs in at the ${ownName} portal.`
      : `This account cannot sign in to the ${PORTAL_LABEL[portal]} portal.`,
  );
}
