import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { ACCESS_COOKIE } from "@/lib/auth/session";
import {
  isPortalSubdomain,
  SUBDOMAIN_ALLOWED_ROLES,
  type PortalSubdomain,
} from "@/lib/auth/portals";
import type { Role } from "@/lib/auth/types";

/**
 * Two jobs:
 *  1. Rewrite a portal subdomain to its route group (admin.… -> /admin/…).
 *  2. Enforce that the session's ROLE is allowed on that subdomain — a wrong
 *     role (or no session) is bounced to that portal's /login. This is the
 *     server-side gate; the login redirectTo is only a client convenience.
 *
 * Edge-safe: verifies the JWT with jose (no Prisma/Node APIs here).
 */

const PORTAL_SUBDOMAINS = ["admin", "reception", "doctor", "labs", "pharmacy"];

async function roleFromRequest(req: NextRequest): Promise<Role | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (payload.typ !== "access" || typeof payload.role !== "string") return null;
    return payload.role as Role;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const sub = host.split(".")[0].split(":")[0];
  const { pathname, search } = req.nextUrl;

  // API is same-origin on every subdomain — never rewrite or gate it here.
  if (pathname.startsWith("/api")) return NextResponse.next();

  const onPortalSubdomain = isPortalSubdomain(sub);

  if (onPortalSubdomain) {
    const portal = sub as PortalSubdomain;

    // Self-heal doubled paths: /reception/book on reception.* becomes /book.
    // Covers hand-typed URLs (the most common desk mistake) and any legacy
    // prefixed links. Redirect (not rewrite) so the address bar is corrected
    // and the receptionist learns the short form by seeing it.
    if (pathname === `/${portal}` || pathname.startsWith(`/${portal}/`)) {
      const url = req.nextUrl.clone();
      url.pathname = pathname.slice(portal.length + 1) || "/";
      url.search = search;
      return NextResponse.redirect(url, 308);
    }

    // The login page for a portal is always reachable (no session yet).
    const isLoginPage = pathname === "/login";

    if (!isLoginPage) {
      const role = await roleFromRequest(req);
      const allowed = role !== null && SUBDOMAIN_ALLOWED_ROLES[portal].includes(role);
      if (!allowed) {
        // Wrong role or no session -> that portal's login, preserving intent.
        const url = req.nextUrl.clone();
        url.pathname = `/${portal}/login`;
        url.search = "";
        // Rewrite (not redirect) so the URL bar stays on the subdomain.
        const h = new Headers(req.headers);
        h.set("x-portal-path", url.pathname);
        return NextResponse.rewrite(url, { request: { headers: h } });
      }
    }

    // Authorized (or the login page): rewrite subdomain -> route group.
    const url = req.nextUrl.clone();
    url.pathname = `/${portal}${pathname}`;
    const h2 = new Headers(req.headers);
    h2.set("x-portal-path", url.pathname);
    return NextResponse.rewrite(url, { request: { headers: h2 } });
  }

  // On the main/public domain: portal route-group paths must not be reachable.
  if (PORTAL_SUBDOMAINS.some((p) => pathname === `/${p}` || pathname.startsWith(`/${p}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = "/not-found";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
