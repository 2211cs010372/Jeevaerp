import { describe, it, expect } from "vitest";
import {
  SUBDOMAIN_ALLOWED_ROLES,
  portalFromRequest,
  roleAllowedOnPortal,
} from "@/lib/auth/portals";
import type { Role } from "@/lib/auth/types";

/**
 * The access model in one sentence: ADMIN works in every portal, and every other
 * staff role works in exactly one. That asymmetry is enforced in three places
 * (middleware, portal layouts, staff login), all reading the table below - so
 * these tests pin the table and the portal resolver the login gate depends on.
 */

const STAFF_ROLES: Role[] = ["ADMIN", "RECEPTIONIST", "DOCTOR", "LAB_TECH", "PHARMACIST"];
const PORTALS = ["admin", "reception", "doctor", "labs", "pharmacy"] as const;

describe("who may work in which portal", () => {
  it("lets ADMIN into every portal", () => {
    for (const p of PORTALS) expect(roleAllowedOnPortal("ADMIN", p)).toBe(true);
  });

  it("confines every other staff role to exactly one portal", () => {
    for (const role of STAFF_ROLES.filter((r) => r !== "ADMIN")) {
      const allowed = PORTALS.filter((p) => roleAllowedOnPortal(role, p));
      expect(allowed).toHaveLength(1);
    }
  });

  it("keeps each role in the portal named after its job", () => {
    expect(roleAllowedOnPortal("RECEPTIONIST", "reception")).toBe(true);
    expect(roleAllowedOnPortal("DOCTOR", "doctor")).toBe(true);
    expect(roleAllowedOnPortal("LAB_TECH", "labs")).toBe(true);
    expect(roleAllowedOnPortal("PHARMACIST", "pharmacy")).toBe(true);
  });

  it("refuses the obvious cross-portal hops", () => {
    expect(roleAllowedOnPortal("RECEPTIONIST", "doctor")).toBe(false);
    expect(roleAllowedOnPortal("RECEPTIONIST", "admin")).toBe(false);
    expect(roleAllowedOnPortal("DOCTOR", "reception")).toBe(false);
    expect(roleAllowedOnPortal("PHARMACIST", "labs")).toBe(false);
    expect(roleAllowedOnPortal("LAB_TECH", "pharmacy")).toBe(false);
  });

  it("admits nobody but ADMIN to the admin portal", () => {
    expect(SUBDOMAIN_ALLOWED_ROLES.admin).toEqual(["ADMIN"]);
  });

  it("never lets a PATIENT into a staff portal", () => {
    for (const p of PORTALS) expect(roleAllowedOnPortal("PATIENT", p)).toBe(false);
  });
});

describe("which portal a sign-in was attempted at", () => {
  it("reads the portal off the host on a real subdomain", () => {
    expect(portalFromRequest({ host: "doctor.jeeva.com" })).toBe("doctor");
    expect(portalFromRequest({ host: "reception.jeeva.com" })).toBe("reception");
  });

  it("reads it off the host in local dev, port and all", () => {
    expect(portalFromRequest({ host: "labs.localhost:3000" })).toBe("labs");
  });

  it("prefers the host over a referer that disagrees", () => {
    // A hand-forged referer must not talk its way into another portal's gate.
    expect(portalFromRequest({
      host: "admin.jeeva.com",
      referer: "https://admin.jeeva.com/reception/login",
    })).toBe("admin");
  });

  it("falls back to the referer path when one host serves every portal", () => {
    expect(portalFromRequest({
      host: "jeeva.vercel.app",
      referer: "https://jeeva.vercel.app/pharmacy/login",
    })).toBe("pharmacy");
  });

  it("reports no portal when neither host nor referer names one", () => {
    expect(portalFromRequest({ host: "jeeva.vercel.app" })).toBeNull();
    expect(portalFromRequest({ host: "www.jeeva.com", referer: "https://www.jeeva.com/about" })).toBeNull();
    expect(portalFromRequest({})).toBeNull();
  });

  it("survives a referer that isn't a URL", () => {
    expect(portalFromRequest({ host: "jeeva.vercel.app", referer: "not a url" })).toBeNull();
  });

  it("ignores a path segment that only looks like a portal", () => {
    expect(portalFromRequest({
      host: "jeeva.vercel.app",
      referer: "https://jeeva.vercel.app/receptionist/login",
    })).toBeNull();
  });
});
