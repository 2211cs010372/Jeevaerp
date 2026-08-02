import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { TOPICS, EVENTS, channelFor, isTopic, type Topic } from "@/lib/realtime/topics";

/**
 * The bug this file locks down.
 *
 * Live updates were half-wired: eight call sites published to the ADMIN topic
 * and NO screen subscribed to it, reception was published nine kinds of change
 * and listened on one screen, and the doctor - the person who actually acts on a
 * lab result - had no topic at all. So a result entered at the bench reached the
 * front desk instantly and the consulting room only on a manual refresh.
 *
 * Publishing to a topic nobody reads is worse than not publishing: it costs a
 * POST on a request a user is waiting on and changes nothing on any screen. So
 * the invariant is symmetry - every topic published to must have a reader, and
 * every topic read must have a writer.
 */

const SRC = path.resolve(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

const files = walk(SRC).map((f) => ({ path: f, text: readFileSync(f, "utf8") }));

/** Topics named inside a publishLive(...) call anywhere in the server code. */
const published = new Set<Topic>();
/** Topics named inside a useLive(...) call anywhere in the client code. */
const subscribed = new Set<Topic>();

for (const f of files) {
  // The declaration file itself names every topic; it is neither side.
  if (f.path.endsWith(path.join("realtime", "topics.ts"))) continue;

  for (const [, args] of f.text.matchAll(/publishLive\(([\s\S]*?)\)/g)) {
    for (const [, key] of args.matchAll(/TOPICS\.(\w+)/g)) {
      const t = TOPICS[key as keyof typeof TOPICS];
      if (t) published.add(t);
    }
  }
  for (const [, args] of f.text.matchAll(/useLive\(([\s\S]*?)\)/g)) {
    for (const [, key] of args.matchAll(/TOPICS\.(\w+)/g)) {
      const t = TOPICS[key as keyof typeof TOPICS];
      if (t) subscribed.add(t);
    }
  }
}

describe("the topic vocabulary", () => {
  it("gives every portal that shows live data a topic", () => {
    // DOCTOR was the one missing, and its absence was the whole bug.
    expect(Object.values(TOPICS)).toContain("doctor");
  });

  it("namespaces channels so the Supabase project can be shared", () => {
    for (const t of Object.values(TOPICS)) expect(channelFor(t)).toBe(`jeeva:${t}`);
  });

  it("recognises a portal slug as a topic, and rejects anything else", () => {
    // The portal shell relies on this to subscribe to whichever portal it is
    // rendering without a second lookup table to keep in step.
    expect(isTopic("reception")).toBe(true);
    expect(isTopic("doctor")).toBe(true);
    expect(isTopic("settings")).toBe(false);
    expect(isTopic("")).toBe(false);
  });

  it("names events after the real-world thing, not the table", () => {
    // A screen subscribes because it cares about the EVENT; the tables behind
    // any given event have already been reorganised once.
    for (const e of Object.values(EVENTS)) {
      expect(e, e).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });
});

describe("publishers and subscribers agree", () => {
  it("finds both sides wired up at all", () => {
    // Guards the scan itself: if the regexes stop matching, every assertion
    // below would pass vacuously and this file would silently stop working.
    expect(published.size).toBeGreaterThan(3);
    expect(subscribed.size).toBeGreaterThan(3);
  });

  it("has a screen listening for every topic something publishes to", () => {
    const deaf = [...published].filter((t) => !subscribed.has(t));
    expect(deaf, `published to but nothing subscribes: ${deaf.join(", ")}`).toEqual([]);
  });

  it("has something publishing to every topic a screen listens on", () => {
    // The other direction: a screen waiting on a signal that is never sent
    // looks live and never moves, which is worse than a screen that is openly
    // static because nobody thinks to press refresh.
    const mute = [...subscribed].filter((t) => !published.has(t));
    expect(mute, `subscribed to but nothing publishes: ${mute.join(", ")}`).toEqual([]);
  });

  it("reaches the doctor when a result comes back", () => {
    // The specific regression: LAB_RESULTED used to go to labs + reception
    // only, so the one person who acts on the result was the one not told.
    const labs = files.find((f) => f.path.endsWith(path.join("services", "labs.service.ts")));
    expect(labs).toBeDefined();
    for (const [, args] of labs!.text.matchAll(/publishLive\(([\s\S]*?)EVENTS\.LAB_RESULTED/g)) {
      expect(args, "a LAB_RESULTED publish that skips the doctor").toContain("TOPICS.DOCTOR");
    }
  });

  it("tells the consulting room when a patient is checked in", () => {
    // Reception checking someone in has to put them on the doctor's queue
    // before they finish walking down the corridor.
    const appts = files.find((f) => f.path.endsWith(path.join("services", "appointments.service.ts")));
    expect(appts).toBeDefined();
    expect(appts!.text).toContain("EVENTS.APPOINTMENT_CHANGED");
    expect(appts!.text).toContain("TOPICS.DOCTOR");
  });
});
