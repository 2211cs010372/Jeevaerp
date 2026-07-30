import { describe, it, expect } from "vitest";
import { parsePgUrl, isSameDatabase, backupFilename, planRotation } from "@/lib/backup";

/**
 * isSameDatabase is the only thing standing between a quarterly restore drill and
 * an erased hospital. It gets the paranoid treatment: every way two URLs can look
 * different while addressing the same database, and every way the input can be
 * garbage.
 */

describe("parsePgUrl", () => {
  it("reads host, port and database", () => {
    expect(parsePgUrl("postgresql://user:pw@db.example.com:5432/jeeva")).toEqual({
      host: "db.example.com",
      port: "5432",
      database: "jeeva",
      user: "user",
    });
  });

  it("defaults a missing port to 5432 so it compares against an explicit one", () => {
    expect(parsePgUrl("postgresql://db.example.com/jeeva")?.port).toBe("5432");
  });

  it("accepts the postgres:// scheme as well as postgresql://", () => {
    expect(parsePgUrl("postgres://db/jeeva")?.database).toBe("jeeva");
  });

  it("lowercases the host, because DNS is case-insensitive", () => {
    expect(parsePgUrl("postgresql://DB.Example.COM/jeeva")?.host).toBe("db.example.com");
  });

  const junk = ["", "not a url", "https://db.example.com/jeeva", "postgresql://db", "postgresql:///jeeva"];
  for (const j of junk) {
    it(`returns null for junk: ${JSON.stringify(j)}`, () => expect(parsePgUrl(j)).toBeNull());
  }
});

describe("isSameDatabase - the guard on a destructive restore", () => {
  const prod = "postgresql://postgres:secret@db.abcdefg.supabase.co:5432/postgres";

  it("catches the identical URL", () => {
    expect(isSameDatabase(prod, prod)).toBe(true);
  });

  it("catches a different user on the same database", () => {
    // Connecting as someone else drops exactly the same tables.
    const other = "postgresql://admin:other@db.abcdefg.supabase.co:5432/postgres";
    expect(isSameDatabase(prod, other)).toBe(true);
  });

  it("catches an omitted port that resolves to the same 5432", () => {
    expect(isSameDatabase(prod, "postgresql://postgres:secret@db.abcdefg.supabase.co/postgres")).toBe(true);
  });

  it("catches a differently-cased host", () => {
    expect(isSameDatabase(prod, "postgresql://postgres:secret@DB.ABCDEFG.supabase.co:5432/postgres")).toBe(true);
  });

  it("allows a genuinely different database on the same host", () => {
    expect(isSameDatabase(prod, "postgresql://postgres:secret@db.abcdefg.supabase.co:5432/jeeva_restore_test")).toBe(false);
  });

  it("allows a different host", () => {
    expect(isSameDatabase(prod, "postgresql://postgres:pw@localhost:5432/postgres")).toBe(false);
  });

  it("treats the pooled and session ports as different addresses", () => {
    // Same data, but this is a port comparison and 6543 is not 5432. The script
    // checks BOTH DIRECT_URL and DATABASE_URL for exactly this reason.
    const pooled = "postgresql://postgres:secret@db.abcdefg.supabase.co:6543/postgres";
    expect(isSameDatabase(prod, pooled)).toBe(false);
  });

  it("fails closed on unparseable input", () => {
    // A mangled production URL must block the run, never wave it through.
    expect(isSameDatabase("garbage", "postgresql://localhost/scratch")).toBe(true);
    expect(isSameDatabase(prod, "garbage")).toBe(true);
    expect(isSameDatabase("", "")).toBe(true);
  });
});

describe("backupFilename", () => {
  it("is sortable and free of characters Windows rejects", () => {
    const name = backupFilename(new Date("2026-07-30T16:04:05.678Z"));
    expect(name).toBe("jeeva-2026-07-30T16-04-05Z.dump");
    expect(name).not.toMatch(/[:*?"<>|]/);
  });

  it("sorts chronologically as a plain string, which is what rotation relies on", () => {
    const a = backupFilename(new Date("2026-07-30T09:00:00Z"));
    const b = backupFilename(new Date("2026-07-30T10:00:00Z"));
    const c = backupFilename(new Date("2026-08-01T09:00:00Z"));
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });
});

describe("planRotation", () => {
  const files = [
    "jeeva-2026-07-28T09-00-00Z.dump",
    "jeeva-2026-07-29T09-00-00Z.dump",
    "jeeva-2026-07-30T09-00-00Z.dump",
  ];

  it("keeps the newest N and removes the rest", () => {
    const { keep, remove } = planRotation(files, 2);
    expect(keep).toEqual(["jeeva-2026-07-30T09-00-00Z.dump", "jeeva-2026-07-29T09-00-00Z.dump"]);
    expect(remove).toEqual(["jeeva-2026-07-28T09-00-00Z.dump"]);
  });

  it("removes nothing when there are fewer dumps than the limit", () => {
    expect(planRotation(files, 14).remove).toEqual([]);
  });

  it("never deletes the only backup, even if keep is 0 or negative", () => {
    // A typo in a cron file must not be able to mean "delete what you just took".
    expect(planRotation(files, 0).keep).toHaveLength(1);
    expect(planRotation(files, -5).keep).toHaveLength(1);
  });

  it("ignores files that are not dumps", () => {
    const mixed = [...files, "README.md", "notes.txt", ".DS_Store", "jeeva-old.sql"];
    const { keep, remove } = planRotation(mixed, 1);
    expect([...keep, ...remove].sort()).toEqual([...files].sort());
  });

  it("handles an empty directory", () => {
    expect(planRotation([], 14)).toEqual({ keep: [], remove: [] });
  });
});
