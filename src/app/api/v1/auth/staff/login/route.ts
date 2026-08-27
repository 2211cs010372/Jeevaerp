import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { staffLoginSchema } from "@/server/validators/auth";
import { staffLogin, recordStaffLogin } from "@/server/services/auth.service";
import { auditContext } from "@/server/services/audit.service";
import { setSessionCookies } from "@/lib/auth/session";
import { destinationForLogin } from "@/lib/auth/portals";
import { assertPortalLogin } from "@/lib/auth/guard";
import { resolveOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const { username, password } = await parseBody(req, staffLoginSchema);
  const ctx = auditContext(req);
  // The IP is the second throttle key: it is what stops one attacker spraying a
  // single password across every username they can guess, which no per-username
  // limit would ever notice.
  const { tokens, user } = await staffLogin(username, password, { ipAddress: ctx.ipAddress });
  // Right credentials, wrong portal: refuse before any cookie is set or any
  // successful login is recorded. Checked only AFTER the password verified, so
  // it can't be used to probe which usernames exist or what role they hold.
  const portal = assertPortalLogin(req, user.role);
  await recordStaffLogin(user.id, "PASSWORD", ctx);

  // Land where they signed in. Only ADMIN can reach a portal that isn't its
  // own, and only after the check above cleared it - see destinationForLogin.
  const redirectTo = destinationForLogin(user.role, portal, resolveOrigin(req));

  const res = NextResponse.json({ user, redirectTo });
  setSessionCookies(res, tokens);
  return res;
});
