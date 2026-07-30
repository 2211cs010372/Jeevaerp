import { prisma } from "@/lib/prisma";

/**
 * Server crash capture - the thing that makes a 500 at the billing counter
 * visible instead of silent.
 *
 * Every API route already funnels through `handler()` in src/lib/api.ts, so this
 * service has exactly one caller and covers all of them. Nothing here may throw:
 * a failure to record a crash must never become a second crash, which is the
 * same contract logAudit holds.
 */

/**
 * Identifiers that must not be stored, even inside a stack trace.
 *
 * A crash carries patient data whether or not you meant it to. The path holds a
 * UHID; a Prisma uniqueness error quotes the phone number that collided; a
 * validation message echoes what was typed. Redacting at the point of capture is
 * the only place it is guaranteed, because everything downstream (the admin
 * viewer, a CSV export, a support screenshot) reads from the stored string.
 *
 * Order matters: UHIDs before digit runs, or `JMH2026OP00123` loses its tail to
 * the phone-number rule and stops being recognizable as an ID at all.
 */
const REDACTIONS: [RegExp, string][] = [
  // JMH2026OP00123 / JMH2026IP00007 - see src/lib/ids.ts
  [/\bJMH\d{4}(?:OP|IP)\d{5}\b/g, "[uhid]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/gi, "[email]"],
  // 10-digit Indian mobile, with or without +91 / 0 prefix
  [/(?:\+91[\s-]?|\b0)?\b[6-9]\d{9}\b/g, "[phone]"],
  // Anything that looks like a secret the error decided to print back
  [/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "[jwt]"],
];

/** Strip patient identifiers and secrets from a message or stack. */
export function scrub(text: string): string {
  return REDACTIONS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

/**
 * Collapse a filled request path down to its route shape.
 *
 *   /api/v1/reception/patients/JMH2026OP00123  ->  /api/v1/reception/patients/:id
 *   /api/v1/ipd/admissions/ckq3x.../charges    ->  /api/v1/ipd/admissions/:id/charges
 *
 * This does two jobs at once: it keeps the stored route free of patient
 * identifiers, and it makes the fingerprint stable so the same bug hit by twenty
 * different patients is one row rather than twenty.
 */
export function normalizeRoute(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (/^JMH\d{4}(?:OP|IP)\d{5}$/.test(seg)) return ":id";
      if (/^c[a-z0-9]{20,}$/i.test(seg)) return ":id"; // cuid
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
      if (/^\d+$/.test(seg)) return ":id";
      return seg;
    })
    .join("/");
}

/**
 * A stable id for "this same bug".
 *
 * Built from the error name, the route shape, and the message with every number
 * blanked - so "Cannot read x of undefined at row 41" and "...at row 87" group
 * together instead of filing two bugs for one defect. Hashed with a plain
 * djb2-style loop rather than node:crypto so this stays usable from any runtime
 * the route handlers run on (edge included).
 */
export function fingerprint(name: string, route: string, message: string): string {
  const shape = `${name}|${route}|${message.replace(/\d+/g, "#").slice(0, 300)}`;
  let h = 5381;
  for (let i = 0; i < shape.length; i++) h = ((h << 5) + h + shape.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What `handler()` knows about the request that crashed. */
export interface CaptureContext {
  pathname: string;
  method: string;
  status?: number;
  actorUserId?: string | null;
  actorRole?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Record one crash. Best-effort by contract: swallows its own failures and
 * always falls back to the server console, so a crash is never lost just
 * because the database is the thing that is broken.
 */
export async function captureError(err: unknown, ctx: CaptureContext): Promise<void> {
  const name = err instanceof Error ? err.name || "Error" : typeof err;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const route = normalizeRoute(ctx.pathname);
  const message = scrub(rawMessage).slice(0, 2000);
  const stack = err instanceof Error && err.stack ? scrub(err.stack).slice(0, 8000) : null;
  const fp = fingerprint(name, route, message);

  // Console first and unconditionally. If the write below fails there is still a
  // record somewhere, and in dev the console is where anyone is actually looking.
  console.error(`[error] ${ctx.method} ${route} [${fp}] ${name}: ${message}`);

  try {
    // updateMany-then-create rather than upsert: two requests can crash on the
    // same fingerprint in the same millisecond, and upsert races to a P2002 on
    // the unique index. This ordering means the loser of the race loses one
    // increment, which costs nothing, instead of throwing.
    const touched = await prisma.errorLog.updateMany({
      where: { fingerprint: fp },
      data: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        // A repeat of a resolved bug is a live bug again.
        resolvedAt: null,
        resolvedBy: null,
      },
    });
    if (touched.count > 0) return;

    await prisma.errorLog.create({
      data: {
        route,
        method: ctx.method,
        status: ctx.status ?? 500,
        name,
        message,
        stack,
        fingerprint: fp,
        actorUserId: ctx.actorUserId ?? null,
        actorRole: ctx.actorRole ?? null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  } catch (writeErr) {
    console.error("[error] failed to record crash:", writeErr);
  }
}

/** Newest-first crash list for the admin viewer. */
export async function listErrors(opts: { includeResolved?: boolean; limit?: number } = {}) {
  const rows = await prisma.errorLog.findMany({
    where: opts.includeResolved ? {} : { resolvedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: opts.limit ?? 100,
  });
  return rows.map((r) => ({
    id: r.id,
    route: r.route,
    method: r.method,
    status: r.status,
    name: r.name,
    message: r.message,
    stack: r.stack,
    count: r.count,
    actorRole: r.actorRole,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));
}

/** How many live bugs there are - drives the badge in the admin nav. */
export async function unresolvedErrorCount(): Promise<number> {
  return prisma.errorLog.count({ where: { resolvedAt: null } });
}

/**
 * Mark a bug handled. Not a delete: the row stays, and `captureError` clears
 * `resolvedAt` again if it recurs, so "fixed" is a claim the data can contradict.
 */
export async function resolveError(id: string, byUserId: string): Promise<void> {
  await prisma.errorLog.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedBy: byUserId },
  });
}
