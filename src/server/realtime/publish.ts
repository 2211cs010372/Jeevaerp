import { channelFor, type LiveEvent, type Topic } from "@/lib/realtime/topics";

/**
 * Publish a change signal to every portal currently watching a topic.
 *
 * THREE RULES THIS FILE EXISTS TO KEEP:
 *
 * 1. IT NEVER BREAKS THE WORK IT ANNOUNCES. A dispense that succeeded must not
 *    fail because a notification did. Every path here swallows its errors and
 *    logs at most a warning. The worst outcome of this file being completely
 *    broken is that screens go back to updating on refresh - which is exactly
 *    where they were before it existed.
 *
 * 2. IT NEVER BLOCKS FOR LONG. Called after a transaction commits, on a
 *    serverless request the user is waiting on. Hard 2 s ceiling; on Vercel in
 *    bom1 talking to Supabase the real number is a few milliseconds.
 *
 * 3. IT NEVER CARRIES PATIENT DATA. Enforced by the LiveSignal type - see
 *    lib/realtime/topics.ts for the reasoning.
 */

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Absent config is a normal state (local dev, CI) - stay silent and do nothing. */
export const realtimeConfigured = Boolean(URL_BASE && KEY);

let warned = false;

/**
 * Fire a signal at one or more topics.
 *
 * Deliberately NOT awaited by most callers in a way that can stall them - but it
 * IS awaited internally, because on serverless a floating promise is killed the
 * moment the response is sent, which would drop the notification perhaps half the
 * time. A couple of milliseconds is the right price for the message arriving.
 */
export async function publishLive(
  topics: Topic | Topic[],
  event: LiveEvent,
  n?: number
): Promise<void> {
  if (!realtimeConfigured) {
    if (!warned && process.env.NODE_ENV !== "production") {
      warned = true;
      console.warn("[realtime] Supabase env not set - portals will fall back to refresh-on-focus.");
    }
    return;
  }

  const list = Array.isArray(topics) ? topics : [topics];
  const payload = { event, at: Date.now(), ...(n === undefined ? {} : { n }) };

  try {
    const res = await fetch(`${URL_BASE}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        messages: list.map((t) => ({ topic: channelFor(t), event, payload })),
      }),
      // A notification is never worth holding a user's request open for.
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!res.ok && process.env.NODE_ENV !== "production") {
      console.warn(`[realtime] broadcast ${event} -> HTTP ${res.status}`);
    }
  } catch (err) {
    // Includes the timeout. Never rethrow: see rule 1.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[realtime] broadcast ${event} failed:`, (err as Error).message);
    }
  }
}
