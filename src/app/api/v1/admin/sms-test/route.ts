import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { logAudit } from "@/server/services/audit.service";
import { auditContext } from "@/server/services/audit.service";
import { smsStatus, smsBalance, sendTestSms } from "@/lib/sms";
import { isIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Current provider, route and wallet - answers "why is SMS not working" without sending. */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  return NextResponse.json({ status: smsStatus(), balance: await smsBalance() });
});

const testSchema = z.object({
  phone: z.string().trim().refine(isIndianMobile, "Enter a valid 10-digit mobile number"),
  route: z.enum(["q", "otp", "dlt"]).optional(),
  text: z.string().trim().max(300).optional(),
  // Supplied from the form so a DLT template can be PROVEN before it is
  // committed to an environment variable and redeployed.
  templateId: z.string().trim().max(40).optional(),
  senderId: z.string().trim().max(11).optional(),
  variables: z.string().trim().max(200).optional(),
});

/**
 * Send ONE real SMS and return the provider's verbatim reply.
 *
 * ADMIN only, and audited with the destination recorded: this spends the
 * hospital's credits and puts a message on somebody's phone, so it should never
 * be possible to do it anonymously or without a trace.
 *
 * The provider's raw response is returned deliberately. An administrator
 * debugging "no OTPs are arriving" needs the actual status code - 996 means
 * complete website verification, 412 means the key is wrong, and no message
 * written for a patient can convey the difference.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "ADMIN");
  const input = await parseBody(req, testSchema);

  const result = await sendTestSms(input.phone, {
    route: input.route,
    text: input.text,
    templateId: input.templateId,
    senderId: input.senderId,
    variables: input.variables,
  });

  await logAudit(actor, {
    action: "SMS_TEST_SENT",
    targetTable: "HospitalConfig",
    targetId: "sms",
    meta: { to: result.to, route: result.route, sent: result.sent },
    ...auditContext(req),
  });

  return NextResponse.json(result);
});
