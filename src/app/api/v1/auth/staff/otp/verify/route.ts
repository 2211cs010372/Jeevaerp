import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { staffOtpVerifySchema } from "@/server/validators/auth";
import { verifyStaffOtp, recordStaffLogin } from "@/server/services/auth.service";
import { auditContext } from "@/server/services/audit.service";
import { setSessionCookies } from "@/lib/auth/session";
import { destinationFor } from "@/lib/auth/portals";
import { assertPortalLogin } from "@/lib/auth/guard";
import { resolveOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const { username, code } = await parseBody(req, staffOtpVerifySchema);
  const { tokens, user } = await verifyStaffOtp(username, code);
  // Wrong portal for this role - refuse before the session cookie is set. The
  // sibling /otp/request step stays ungated on purpose: it is enumeration-safe
  // by design, and naming the caller's portal there would answer "does this
  // username exist, and what is it?" for anyone who typed a guess.
  assertPortalLogin(req, user.role);
  await recordStaffLogin(user.id, "OTP", auditContext(req));
  const redirectTo = destinationFor(user.role, resolveOrigin(req));
  const res = NextResponse.json({ user, redirectTo });
  setSessionCookies(res, tokens);
  return res;
});
