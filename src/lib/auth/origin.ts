import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { classifyHost } from "@/lib/auth/host";

/**
 * Works out the base (rootDomain / protocol / port) for building post-login
 * redirect URLs. Delegates host classification to the shared `classifyHost`
 * (same logic the middleware enforces) so routing can't drift:
 *
 *  custom : "reception.jeevamultispecialityhospital.com" -> root "jeevamultispecialityhospital.com"
 *  dev    : "reception.localhost:3000"                   -> root "localhost", port "3000"
 *  vercel : "app.vercel.app" / bare IP                   -> no root (path-prefix fallback)
 */
export function resolveOrigin(req: NextRequest): {
  rootDomain?: string;
  protocol: string;
  port?: string;
} {
  const host = req.headers.get("host") ?? "";
  const protocol = req.headers.get("x-forwarded-proto") ?? (env().NODE_ENV === "production" ? "https" : "http");
  const { rootDomain, port } = classifyHost(host, env().COOKIE_DOMAIN);
  return { rootDomain, protocol, port };
}
