"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { channelFor, type LiveEvent, type Topic } from "@/lib/realtime/topics";

/**
 * Re-run `onChange` when something relevant happens elsewhere in the hospital.
 *
 * Usage is deliberately dull: give it the topics your screen displays and the
 * loader it already has.
 *
 *     useLive([TOPICS.PHARMACY], load);
 *
 * WHAT IT GUARANTEES
 *
 * - The callback is never called while a previous run is still in flight, and
 *   bursts collapse into one run. Reception sending five prescriptions in ten
 *   seconds must not fire five overlapping fetches at a counter tablet.
 *
 * - It keeps working when the socket does not. Three independent triggers feed
 *   the same debounced refresh: the realtime signal (instant), returning to the
 *   tab (free, and catches anything missed while the laptop lid was shut), and a
 *   slow safety poll that ONLY runs while the socket is disconnected. If
 *   Supabase realtime is switched off entirely, screens still self-update on a
 *   lazy timer instead of freezing until somebody presses F5.
 *
 * - It never polls fast. The fallback is measured in tens of seconds on purpose:
 *   a quick poll from every open portal is a per-request bill on Vercel and a
 *   connection on Supabase, which is the cost this whole design avoids.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not hand you data. The signal carries none - `onChange` is expected to
 * re-fetch through the normal authenticated API so role checks still apply.
 */

/** While disconnected, check back this often. Long on purpose - see above. */
const FALLBACK_MS = 45_000;
/** Collapse a burst of signals into one refresh. */
const DEBOUNCE_MS = 350;

export function useLive(
  topics: Topic[],
  onChange: () => void | Promise<void>,
  opts?: {
    /** Only react to these events. Omit to react to every event on the topic. */
    events?: LiveEvent[];
    /** Set false to suspend (e.g. while a form is open and a reload would fight the user). */
    enabled?: boolean;
  }
) {
  // The callback changes identity on every render of most pages; keeping it in a
  // ref means the subscription is not torn down and rebuilt each time, which
  // would otherwise reconnect the socket on every keystroke in a filter box.
  const cb = useRef(onChange);
  cb.current = onChange;

  const events = opts?.events;
  const enabled = opts?.enabled ?? true;
  const eventKey = events ? events.join(",") : "*";
  const topicKey = topics.join(",");

  useEffect(() => {
    if (!enabled || topics.length === 0) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let queued = false;
    let connected = false;

    const run = async () => {
      if (disposed) return;
      // Serialise: if one is already going, remember to do it once more after.
      if (running) { queued = true; return; }
      running = true;
      try { await cb.current(); }
      catch { /* the screen's own error handling owns this */ }
      finally {
        running = false;
        if (queued && !disposed) { queued = false; schedule(); }
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    };

    const allowed = (name: string) => !events || (events as string[]).includes(name);

    // ── 1. the realtime signal ───────────────────────────────────────────────
    const supabase = getSupabase();
    const channels = supabase
      ? topics.map((t) => {
          const ch = supabase.channel(channelFor(t), { config: { broadcast: { self: true } } });
          // Wildcard: one handler for every event on the topic, filtered here.
          ch.on("broadcast", { event: "*" }, (msg: { event: string }) => {
            if (allowed(msg.event)) schedule();
          });
          ch.subscribe((status: string) => {
            if (status === "SUBSCRIBED") {
              // A reconnect means we may have missed something while away.
              if (!connected) { connected = true; schedule(); }
            } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              connected = false;
            }
          });
          return ch;
        })
      : [];

    // ── 2. coming back to the tab ────────────────────────────────────────────
    const onFocus = () => { if (document.visibilityState === "visible") schedule(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    // ── 3. the safety net, only while the socket is down ─────────────────────
    const poll = setInterval(() => { if (!connected) schedule(); }, FALLBACK_MS);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      for (const ch of channels) { try { ch.unsubscribe(); } catch { /* already gone */ } }
    };
    // topicKey/eventKey are stable string joins - the arrays themselves are new
    // literals on every render and would otherwise resubscribe constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, eventKey, enabled]);
}
