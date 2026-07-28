import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

/**
 * Append an audit-trail row. Staff actions set actorUserId; patient actions set
 * actorPatientId. Best-effort and never throws into the caller - an audit
 * failure must not break the real action.
 *
 * ANONYMOUS ACTIONS SET NEITHER. The public website can act without any account
 * behind it - a callback request is raised by somebody who is deliberately not
 * in the patient index yet. Passing `null` records what happened with no actor,
 * which is the truth. Previously such callers invented an actor id, and because
 * both columns are foreign keys the insert failed and the row was silently
 * dropped - an audit trail with a hole in it exactly where an unauthenticated
 * endpoint writes.
 */
export async function logAudit(
  actor: AuthUser | null,
  entry: {
    action: string;
    targetTable: string;
    targetId: string;
    meta?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  },
  tx?: Prisma.TransactionClient
): Promise<void> {
  const db = tx ?? prisma;
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        meta: entry.meta,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        ...(actor === null
          ? {}
          : actor.role === "PATIENT"
            ? { actorPatientId: actor.id }
            : { actorUserId: actor.id }),
      },
    });
  } catch (err) {
    console.error("[audit] failed to write log:", err);
  }
}

/** Pulls client IP + UA from a request for audit context. */
export function auditContext(req: Request): { ipAddress?: string; userAgent?: string } {
  const xff = req.headers.get("x-forwarded-for");
  return {
    ipAddress: xff?.split(",")[0]?.trim() || undefined,
    userAgent: req.headers.get("user-agent") || undefined,
  };
}
