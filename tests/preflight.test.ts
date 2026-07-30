import { describe, it, expect } from "vitest";
import {
  isTransactionPooled, isSessionPooler, pgMajor, clientCanDump, dumpAgeHours,
  BACKUP_STALE_HOURS, needsCookieDomain, cookieDomainLooksShared, worst,
} from "@/lib/preflight";

/**
 * A preflight check that gets its own logic wrong is worse than no check: it says
 * READY and is believed. The two rules with real consequences are which connection
 * is the pooled one (a DIRECT_URL on the pooler gives failing migrations and
 * quietly incomplete backups) and the pg_dump version direction (a too-old client
 * refuses outright).
 */

describe("isTransactionPooled - the mode, never the hostname", () => {
  const bad = [
    "postgresql://postgres.abc:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    "postgresql://postgres:pw@db.example.com:6543/postgres",
    "postgresql://u:p@h:5432/db?pgbouncer=true",
    "postgresql://u:p@h:5432/db?pool_mode=transaction",
  ];
  for (const u of bad) {
    it(`flags transaction mode: ${u.slice(0, 50)}…`, () => expect(isTransactionPooled(u)).toBe(true));
  }

  const fine = [
    // THE REGRESSION. An earlier version keyed on the "pooler." hostname and
    // reported this - a working, already-migrated setup - as a blocker. Session
    // mode on 5432 is a passthrough: it runs DDL and pg_dump.
    "postgresql://postgres.abc:pw@aws-1-ap-south-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres:pw@db.abcdefg.supabase.co:5432/postgres",
    "postgresql://postgres:postgres@localhost:5432/jeeva_erp?schema=public",
  ];
  for (const u of fine) {
    it(`allows session mode: ${u.slice(0, 50)}…`, () => expect(isTransactionPooled(u)).toBe(false));
  }

  it("does not crash on junk", () => {
    expect(isTransactionPooled("")).toBe(false);
    expect(isTransactionPooled("not a url")).toBe(false);
  });
});

describe("isSessionPooler - workable, but worth naming", () => {
  it("recognises the pooler host on the session port", () => {
    expect(isSessionPooler("postgresql://u:p@aws-1.pooler.supabase.com:5432/postgres")).toBe(true);
  });
  it("does not double-report a transaction-pooled url", () => {
    expect(isSessionPooler("postgresql://u:p@aws-1.pooler.supabase.com:6543/postgres?pgbouncer=true")).toBe(false);
  });
  it("is false for a truly direct host", () => {
    expect(isSessionPooler("postgresql://u:p@db.abcdefg.supabase.co:5432/postgres")).toBe(false);
  });
});

describe("pgMajor", () => {
  const cases: [string, number | null][] = [
    ["17.6", 17],
    ["PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc", 17],
    ["pg_dump (PostgreSQL) 17.2", 17],
    ["pg_dump (PostgreSQL) 15.8", 15],
    ["16", 16],
    ["", null],
    ["no digits here", null],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input.slice(0, 40))} -> ${want}`, () => expect(pgMajor(input)).toBe(want));
  }
});

describe("clientCanDump - the direction matters", () => {
  it("allows an equal major", () => expect(clientCanDump(17, 17)).toBe(true));
  it("allows a newer client against an older server", () => expect(clientCanDump(17, 15)).toBe(true));
  it("refuses an older client against a newer server", () => {
    // This is the real mistake: installing client 15 against your 17.6 server.
    expect(clientCanDump(15, 17)).toBe(false);
  });
});

describe("dumpAgeHours", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  it("measures hours since the dump", () => {
    expect(dumpAgeHours(new Date("2026-07-31T02:00:00Z"), now)).toBe(10);
  });
  it("treats a 2 AM nightly checked at lunch the next day as healthy", () => {
    // 34h. A 24h threshold would cry wolf every afternoon, and a check that cries
    // wolf gets ignored - which is worse than not having one.
    const age = dumpAgeHours(new Date("2026-07-30T02:00:00Z"), now);
    expect(age).toBeGreaterThan(24);
    expect(age).toBeLessThan(BACKUP_STALE_HOURS);
  });
  it("flags a dump from three days ago", () => {
    expect(dumpAgeHours(new Date("2026-07-28T12:00:00Z"), now)).toBeGreaterThan(BACKUP_STALE_HOURS);
  });
});

describe("needsCookieDomain", () => {
  it("is required on a real host, because the portals are subdomains", () => {
    expect(needsCookieDomain("https://www.jeevamultispecialityhospital.com")).toBe(true);
  });
  it("is not required on localhost", () => {
    expect(needsCookieDomain("http://localhost:3000")).toBe(false);
    expect(needsCookieDomain("http://127.0.0.1:3000")).toBe(false);
  });
  it("is not claimed when the site url is unknown", () => {
    expect(needsCookieDomain(undefined)).toBe(false);
    expect(needsCookieDomain("garbage")).toBe(false);
  });
});

describe("cookieDomainLooksShared", () => {
  const site = "https://reception.jeevamultispecialityhospital.com";

  it("accepts the parent domain with a leading dot", () => {
    expect(cookieDomainLooksShared(".jeevamultispecialityhospital.com", site)).toBe(true);
  });

  it("rejects a value with no leading dot", () => {
    // Without the dot the cookie is host-only and the other portals cannot read it.
    expect(cookieDomainLooksShared("jeevamultispecialityhospital.com", site)).toBe(false);
  });

  it("rejects a single-portal value, which is the harder bug to spot", () => {
    expect(cookieDomainLooksShared("reception.jeevamultispecialityhospital.com", site)).toBe(false);
  });

  it("rejects a parent that does not match the site host", () => {
    expect(cookieDomainLooksShared(".someotherhospital.com", site)).toBe(false);
  });

  it("tolerates whitespace around a correct value", () => {
    expect(cookieDomainLooksShared("  .jeevamultispecialityhospital.com  ", site)).toBe(true);
  });
});

describe("worst", () => {
  it("reports block over warn over ok", () => {
    expect(worst([{ name: "a", severity: "ok", detail: "" }, { name: "b", severity: "warn", detail: "" }])).toBe("warn");
    expect(worst([{ name: "a", severity: "warn", detail: "" }, { name: "b", severity: "block", detail: "" }])).toBe("block");
    expect(worst([{ name: "a", severity: "ok", detail: "" }])).toBe("ok");
  });
  it("treats an empty list as ok", () => expect(worst([])).toBe("ok"));
});
