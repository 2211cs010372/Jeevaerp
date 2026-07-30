import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

/**
 * The wiring, not the pieces.
 *
 * error-capture.test.ts proves scrub/normalizeRoute/fingerprint behave. This file
 * proves the one thing those cannot: that handler() calls the recorder for real
 * crashes and does NOT call it for the four outcomes it already maps.
 *
 * That distinction is the whole value of the table. If a rejected form or a
 * duplicate phone number were recorded, the one row that means "the billing
 * counter is broken" would sit under ten thousand rows meaning "someone mistyped
 * a date", and the page would be ignored inside a week.
 *
 * captureError is mocked so no database is needed - the assertion is about who
 * gets called, which is exactly where a mock belongs.
 */

const captureError = vi.fn();
vi.mock("@/server/services/errors.service", () => ({
  captureError: (...args: unknown[]) => captureError(...args),
}));

const { handler, ApiError } = await import("@/lib/api");

const req = (path = "/api/v1/reception/patients/JMH2026OP00123", method = "POST") =>
  new NextRequest(`http://localhost${path}`, { method });

const ctx = { params: Promise.resolve({} as Record<string, string>) };

const run = (thrown: unknown, path?: string, method?: string) =>
  handler(async () => {
    throw thrown;
  })(req(path, method), ctx);

beforeEach(() => captureError.mockClear());

describe("handler - records real crashes", () => {
  it("records an unhandled error and still answers 500 with a generic body", async () => {
    const res = await run(new TypeError("Cannot read properties of undefined"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
    expect(captureError).toHaveBeenCalledOnce();
  });

  it("passes the raw pathname and method through for normalization", async () => {
    await run(new Error("boom"), "/api/v1/ipd/admissions/abc/charges", "PATCH");
    const [, capturedCtx] = captureError.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(capturedCtx.pathname).toBe("/api/v1/ipd/admissions/abc/charges");
    expect(capturedCtx.method).toBe("PATCH");
    expect(capturedCtx.status).toBe(500);
  });

  it("records with no actor when the request carries no token", async () => {
    await run(new Error("boom"));
    const [, capturedCtx] = captureError.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(capturedCtx.actorUserId).toBeNull();
    expect(capturedCtx.actorRole).toBeNull();
  });

  it("records a thrown non-Error value rather than dropping it", async () => {
    const res = await run("just a string");
    expect(res.status).toBe(500);
    expect(captureError).toHaveBeenCalledOnce();
  });
});

describe("handler - does NOT record outcomes it already maps", () => {
  it("ignores ApiError and keeps its own status and message", async () => {
    const res = await run(new ApiError(403, "Insufficient permissions for this action"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Insufficient permissions for this action",
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it("ignores ZodError and answers 400 with field errors", async () => {
    const parsed = z.object({ age: z.number() }).safeParse({ age: "x" });
    expect(parsed.success).toBe(false);
    const res = await run(parsed.success ? null : parsed.error);
    expect(res.status).toBe(400);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("ignores a Prisma unique-constraint failure and answers 409", async () => {
    const res = await run(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(res.status).toBe(409);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("ignores a Prisma record-not-found and answers 404", async () => {
    const res = await run(Object.assign(new Error("Record to update not found"), { code: "P2025" }));
    expect(res.status).toBe(404);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("handler - the happy path is untouched", () => {
  it("returns the handler's own response and records nothing", async () => {
    const res = await handler(async () => Response.json({ ok: true }) as never)(req(), ctx);
    expect(res.status).toBe(200);
    expect(captureError).not.toHaveBeenCalled();
  });
});
