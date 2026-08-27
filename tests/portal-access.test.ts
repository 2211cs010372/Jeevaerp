import { describe, it, expect } from "vitest";
import {
  PORTAL_SUBDOMAINS,
  SUBDOMAIN_ALLOWED_ROLES,
  destinationForLogin,
  portalFromRequest,
  roleAllowedOnPortal,
} from "@/lib/auth/portals";
import type { Role } from "@/lib/auth/types";

/**
 * The access model in one sentence: ADMIN and SUPERUSER work in every portal,
 * and every other staff role works in exactly one. That asymmetry is enforced in
 * three places (middleware, portal layouts, staff login), all reading the table
 * below - so these tests pin the table and the portal resolver the login gate
 * depends on.
 */

/** The two roles that clear every door, for different reasons: ADMIN runs the
 *  hospital, SUPERUSER maintains the software. See portals.ts. */
const ALL_ACCESS: Role[] = ["ADMIN", "SUPERUSER"];
/** One desk each, and only their own. */
const DESK_ROLES: Role[] = ["RECEPTIONIST", "DOCTOR", "LAB_TECH", "PHARMACIST", "INSURANCE_DESK"];
// Derived, not a copy. A hand-written list is how `insurance` came to be in two
// of the three places that define a portal and missing from the third; a new
// portal that forgets its role gate should fail here, not pass by omission.
const PORTALS = PORTAL_SUBDOMAINS;

describe("who may work in which portal", () => {
  it("lets both all-access roles into every portal", () => {
    for (const role of ALL_ACCESS) {
      for (const p of PORTALS) expect(roleAllowedOnPortal(role, p), `${role} on ${p}`).toBe(true);
    }
  });

  it("confines every desk role to exactly one portal", () => {
    for (const role of DESK_ROLES) {
      const allowed = PORTALS.filter((p) => roleAllowedOnPortal(role, p));
      expect(allowed, role).toHaveLength(1);
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

  it("admits nobody but the all-access roles to the admin portal", () => {
    expect([...SUBDOMAIN_ALLOWED_ROLES.admin].sort()).toEqual([...ALL_ACCESS].sort());
  });

  it("gates the developer portal exactly as tightly as the admin console", () => {
    // The launcher reaches every portal in the building. Compared against the
    // admin list rather than a literal, so the two can never drift apart -
    // never more loosely gated than the console it can open.
    expect([...SUBDOMAIN_ALLOWED_ROLES.dev].sort()).toEqual([...SUBDOMAIN_ALLOWED_ROLES.admin].sort());
    for (const role of DESK_ROLES) {
      expect(roleAllowedOnPortal(role, "dev"), role).toBe(false);
    }
    expect(roleAllowedOnPortal("PATIENT", "dev")).toBe(false);
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

describe("where a sign-in lands", () => {
  const jeeva = { rootDomain: "jeeva.com", protocol: "https" };

  it("keeps everyone on the portal they signed in at", () => {
    expect(destinationForLogin("RECEPTIONIST", "reception", jeeva)).toBe("https://reception.jeeva.com/");
    expect(destinationForLogin("ADMIN", "admin", jeeva)).toBe("https://admin.jeeva.com/");
  });

  it("lands an ADMIN on the dev portal they actually opened", () => {
    // The whole reason destinationForLogin exists: ADMIN's HOME is the admin
    // console, so the old destinationFor carried them off it - and the dev
    // portal, which is nobody's home, could not be reached by signing in at all.
    expect(destinationForLogin("ADMIN", "dev", jeeva)).toBe("https://dev.jeeva.com/");
    expect(destinationForLogin("ADMIN", "pharmacy", jeeva)).toBe("https://pharmacy.jeeva.com/");
  });

  it("falls back to the role's own portal when there is no portal context", () => {
    expect(destinationForLogin("ADMIN", null, jeeva)).toBe("https://admin.jeeva.com/");
    expect(destinationForLogin("LAB_TECH", null, jeeva)).toBe("https://labs.jeeva.com/");
  });

  it("sends a developer to the launcher, not to the admin console", () => {
    // SUPERUSER clears the admin portal too, so "the portal they belong to" has
    // to be answered deliberately rather than by whichever list is checked first.
    expect(destinationForLogin("SUPERUSER", null, jeeva)).toBe("https://dev.jeeva.com/");
    expect(destinationForLogin("SUPERUSER", "reception", jeeva)).toBe("https://reception.jeeva.com/");
  });

  it("never honours a portal the role is not allowed on", () => {
    // Belt and braces - assertPortalLogin has already refused this login, so
    // reaching here at all would be a bug. It must not be a redirect bug too.
    expect(destinationForLogin("RECEPTIONIST", "doctor", jeeva)).toBe("https://reception.jeeva.com/");
    expect(destinationForLogin("PHARMACIST", "dev", jeeva)).toBe("https://pharmacy.jeeva.com/");
  });

  it("uses path prefixes when there is no root domain (single-host deploys)", () => {
    expect(destinationForLogin("ADMIN", "dev", {})).toBe("/dev");
    expect(destinationForLogin("ADMIN", "admin", {})).toBe("/admin");
  });

  it("still sends a patient to their profile, not a bare portal root", () => {
    expect(destinationForLogin("PATIENT", null, jeeva)).toBe("/portal/profile");
  });
});
