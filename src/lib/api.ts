import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { captureError } from "@/server/services/errors.service";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { readAccessToken } from "@/lib/auth/session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;

/**
 * Who was signed in when a request crashed, or null.
 *
 * Best-effort and deliberately silent: this only ever runs on a path that has
 * already failed, so a bad or missing token here is not news - it just means the
 * crash gets recorded without an actor, which is still worth having.
 */
async function actorOf(req: NextRequest): Promise<{ id: string; role: string } | null> {
  try {
    const token = readAccessToken(req);
    if (!token) return null;
    const payload = await verifyAccessToken(token);
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Wraps every route handler: one place for error mapping.
 *  - ApiError          -> its own status
 *  - ZodError          -> 400 with field errors
 *  - Prisma P2002/P2025 (duck-typed; generated classes not imported) -> 409/404
 *  - anything else     -> 500, recorded in ErrorLog, generic body
 *
 * The last branch is the only one that records. The others are OUTCOMES, not
 * crashes: a rejected form and a duplicate phone number are the system working.
 * Recording them would bury the one row that means something under ten thousand
 * that mean "someone mistyped a date", which is how error tables get ignored.
 */
export function handler(fn: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
          { status: err.status }
        );
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: err.flatten().fieldErrors },
          { status: 400 }
        );
      }
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        return NextResponse.json({ error: "A record with these details already exists" }, { status: 409 });
      }
      if (code === "P2025") {
        return NextResponse.json({ error: "Record not found" }, { status: 404 });
      }
      // Awaited, not fired-and-forgotten. On a serverless host the function can
      // be frozen the moment the response is returned, which would drop the
      // write for exactly the crashes that happen under load. Costing a failed
      // request another few milliseconds is the right trade.
      const actor = await actorOf(req);
      const xff = req.headers.get("x-forwarded-for");
      await captureError(err, {
        pathname: req.nextUrl.pathname,
        method: req.method,
        status: 500,
        actorUserId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        ipAddress: xff?.split(",")[0]?.trim() || undefined,
        userAgent: req.headers.get("user-agent") || undefined,
      });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: { parse: (v: unknown) => T }): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  return schema.parse(raw);
}
