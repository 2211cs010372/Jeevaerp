import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthUser } from "@/lib/auth/types";

/**
 * LAB TESTS ARE PAID FOR AT RECEPTION.
 *
 * The lab bench orders and runs tests; reception takes the money - for an OP
 * patient, an inpatient (on their stay, paid now or due at discharge) or a new
 * walk-in. Hiding the billing screens from the lab portal is not the rule; the
 * rule is that the service refuses a lab login's bill, and refuses it before a
 * single row is written, so a refused bill never leaves a registration or an
 * order behind.
 *
 * The client is a recording stub: any read or write reaches it, and the tests
 * assert that the refusals reach nothing.
 */

const { touched } = vi.hoisted(() => ({ touched: [] as string[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, model) => {
      touched.push(String(model));
      return new Proxy({}, { get: () => async () => { throw new Error(`database reached: ${String(model)}`); } });
    },
  }),
}));

const { walkInOrder, billLabTests, assertMayBillLab, stayOfLabTests } = await import("@/server/services/labs.service");

const as = (role: string) => ({ id: "u1", role } as unknown as AuthUser);
const ctx = {};

beforeEach(() => { touched.length = 0; });

describe("who may bill a lab test", () => {
  it("refuses a lab login", () => {
    expect(() => assertMayBillLab(as("LAB_TECH"))).toThrow(/reception/i);
  });

  it("lets reception and admin bill", () => {
    expect(() => assertMayBillLab(as("RECEPTIONIST"))).not.toThrow();
    expect(() => assertMayBillLab(as("ADMIN"))).not.toThrow();
  });

  it("refuses a lab login's walk-in bill before anything is written", async () => {
    await expect(walkInOrder(as("LAB_TECH"), {
      newPatient: { firstName: "Lakshmi", phone: "+919848012345" },
      catalogIds: ["cbc"], labTestIds: [],
      bill: { payments: [{ mode: "CASH", amount: 400 }] },
    }, ctx)).rejects.toMatchObject({ status: 403 });
    // No registration, no order, no invoice.
    expect(touched).toEqual([]);
  });

  it("refuses a lab login billing earlier tests directly", async () => {
    await expect(billLabTests(as("LAB_TECH"), {
      patientId: "p1", labTestIds: ["t1"],
    }, ctx)).rejects.toMatchObject({ status: 403 });
    expect(touched).toEqual([]);
  });

  it("still lets a lab login ORDER - a walk-in with no bill goes ahead", async () => {
    // It gets as far as the database, which is the point: nothing refused it.
    await expect(walkInOrder(as("LAB_TECH"), {
      patientId: "p1", catalogIds: ["cbc"], labTestIds: [],
    }, ctx)).rejects.toThrow(/database reached/);
    expect(touched.length).toBeGreaterThan(0);
  });
});

describe("which stay a lab bill belongs to", () => {
  it("is an outpatient bill when no test hangs off a stay", () => {
    expect(stayOfLabTests([{ admissionId: null }, { admissionId: null }])).toBeNull();
  });

  it("is the stay's bill when every test hangs off it", () => {
    expect(stayOfLabTests([{ admissionId: "adm1" }, { admissionId: "adm1" }])).toBe("adm1");
  });

  it("refuses an outpatient test on a stay's bill", () => {
    // The discharge desk chases that bill; a test from an earlier OP visit on it
    // would be a due that is not the stay's.
    expect(() => stayOfLabTests([{ admissionId: "adm1" }, { admissionId: null }])).toThrow(/on their own/);
  });

  it("refuses two stays on one bill", () => {
    expect(() => stayOfLabTests([{ admissionId: "adm1" }, { admissionId: "adm2" }])).toThrow(/on their own/);
  });
});
