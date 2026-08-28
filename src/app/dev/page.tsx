import { headers } from "next/headers";
import { env } from "@/lib/env";
import { classifyHost } from "@/lib/auth/host";
import { PORTAL_SUBDOMAINS, type PortalSubdomain } from "@/lib/auth/portals";
import { Launcher, type PortalLink } from "./launcher";

export const dynamic = "force-dynamic";

/**
 * The launcher is built on the SERVER, on purpose.
 *
 * A cross-portal link needs two facts the browser cannot be trusted with here:
 * how this deployment routes portals (subdomains or path prefixes), and whether
 * the session cookie spans them. The first is `classifyHost`, which needs
 * COOKIE_DOMAIN - a server env var. `lib/auth/portal-url.ts` exists for the
 * client and deliberately guesses without it, which is fine for a link inside a
 * page but not for a page whose whole job is those links.
 *
 * Resolving here also means the hrefs are identical on the server and on
 * hydration, so there is no mismatch and no flash of path-mode URLs.
 */

/** Mirrors resolveOrigin (lib/auth/origin.ts), which needs a NextRequest we don't have. */
function origin(h: Headers) {
  const host = h.get("host") ?? "";
  const protocol = h.get("x-forwarded-proto") ?? (env().NODE_ENV === "production" ? "https" : "http");
  const { subdomainMode, rootDomain, port } = classifyHost(host, env().COOKIE_DOMAIN);
  return { host, protocol, subdomainMode, rootDomain, port };
}

export default async function DevHome() {
  const h = await headers();
  const { host, protocol, subdomainMode, rootDomain, port } = origin(h);

  /** The portal's root URL, in whichever shape this deployment actually routes. */
  const baseFor = (portal: PortalSubdomain): string =>
    subdomainMode && rootDomain
      ? `${protocol}://${portal}.${rootDomain}${port ? `:${port}` : ""}`
      : `/${portal}`;

  const portals: PortalLink[] = PORTAL_SUBDOMAINS
    .filter((p): p is Exclude<PortalSubdomain, "dev"> => p !== "dev")
    .map((p) => ({ key: p, base: baseFor(p) }));

  return (
    <Launcher
      portals={portals}
      host={host}
      routing={subdomainMode ? "subdomain" : "path"}
      /**
       * Does one sign-in carry across the portals?
       *
       * Path mode: yes trivially - it is all one host. Subdomain mode: only when
       * COOKIE_DOMAIN is set, because without it the cookie is host-only and
       * every portal is a fresh login. That is exactly the local-dev default, so
       * the launcher says so rather than letting somebody rediscover it by being
       * bounced to a sign-in screen six times.
       */
      sessionSpansPortals={!subdomainMode || Boolean(env().COOKIE_DOMAIN)}
    />
  );
}
