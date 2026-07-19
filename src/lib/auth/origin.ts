import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Works out the base (rootDomain / protocol / port) for building cross-subdomain
 * redirect URLs from the incoming request + configured cookie domain.
 *
 *  prod  : host "reception.jeevamultispecialityhospital.com"
 *          -> rootDomain "jeevamultispecialityhospital.com"
 *  dev   : host "reception.localhost:3000"
 *          -> rootDomain "localhost", port "3000"
 *  single: no dotted root resolvable -> rootDomain undefined (path-prefix fallback)
 */
export function resolveOrigin(req: NextRequest): {
  rootDomain?: string;
  protocol: string;
  port?: string;
} {
  const host = req.headers.get("host") ?? "";
  const [hostname, port] = host.split(":");
  const protocol = req.headers.get("x-forwarded-proto") ?? (env().NODE_ENV === "production" ? "https" : "http");

  // Prefer the explicitly configured cookie domain (".root.com" -> "root.com").
  const configured = env().COOKIE_DOMAIN?.replace(/^\./, "");
  if (configured) return { rootDomain: configured, protocol, port: port || undefined };

  // localhost / *.localhost
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { rootDomain: "localhost", protocol, port: port || undefined };
  }

  // Bare IP or single-label host -> no subdomain routing possible.
  const labels = hostname.split(".");
  if (labels.length < 2 || /^\d+$/.test(labels[labels.length - 1])) {
    return { protocol, port: port || undefined };
  }

  // Strip a known portal subdomain to get the root; else assume last two labels.
  const known = ["admin", "reception", "doctor", "labs", "pharmacy"];
  const root = known.includes(labels[0]) ? labels.slice(1).join(".") : hostname;
  return { rootDomain: root, protocol, port: port || undefined };
}
