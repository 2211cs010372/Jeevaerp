/**
 * LIVE UPDATES - the vocabulary.
 *
 * WHY THIS SHAPE, AND WHY IT CARRIES NO PATIENT DATA
 *
 * The transport is Supabase Realtime "broadcast", which is reachable from the
 * browser with the PUBLISHABLE key. That key is, by design, public. So the rule
 * this module exists to enforce is absolute:
 *
 *     A SIGNAL SAYS THAT SOMETHING CHANGED. IT NEVER SAYS WHAT.
 *
 * No patient name, no ID, no phone, no amount, no diagnosis - nothing that would
 * be a disclosure if a stranger subscribed to the channel. The client receives
 * "the pharmacy queue moved" and then RE-FETCHES through the ordinary
 * authenticated API, where the existing role checks decide what that particular
 * user is allowed to see. A pharmacist and a receptionist can hear the same
 * signal and correctly end up with different data on screen.
 *
 * The alternative - Supabase "Postgres Changes" - streams actual row contents to
 * subscribers and would put prescription rows on that channel. It is the obvious
 * feature to reach for and it is the wrong one here.
 *
 * WHY NOT SERVER-SENT EVENTS OR A SOCKET SERVER
 *
 * This app deploys to Vercel (see vercel.json, region bom1). A held-open SSE
 * connection bills function time for as long as a staff member has the tab open,
 * which for a full shift, times every counter, is precisely the running cost we
 * were asked not to add. A broadcast socket goes browser -> Supabase directly and
 * never touches a Vercel function at all. Publishing costs one small POST per
 * mutation; the subscription costs nothing per second.
 */

/** One topic per place a human is looking. Subscribe to what you display. */
export const TOPICS = {
  RECEPTION: "reception",
  PHARMACY: "pharmacy",
  LABS: "labs",
  IPD: "ipd",
  ADMIN: "admin",
  /**
   * The consulting room. Added late, and its absence was a real hole: the doctor
   * is the person who ACTS on a lab result, and theirs was the one screen with
   * no way to hear that one had come back. They waited on a result that had been
   * sitting in the building since eleven o'clock, or refreshed out of habit.
   */
  DOCTOR: "doctor",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

/**
 * Is this string one of our topics?
 *
 * Exists because a portal's slug and its topic are deliberately the same word
 * ("reception", "pharmacy", …), which lets the shell subscribe to whichever
 * portal it is rendering without a second lookup table to keep in step.
 */
export function isTopic(s: string): s is Topic {
  return (Object.values(TOPICS) as string[]).includes(s);
}

/**
 * What happened. Named for the real-world event, not the table that changed -
 * a screen subscribes because it cares about the event, and the tables behind
 * any given event have already been reorganised once this year.
 */
export const EVENTS = {
  /** Reception sent a prescription up to the counter. */
  PRESCRIPTION_QUEUED: "prescription.queued",
  /** The counter dispensed against one. */
  PRESCRIPTION_DISPENSED: "prescription.dispensed",
  /** Tests ordered for a patient. */
  LAB_ORDERED: "lab.ordered",
  /** A result was entered / verified. */
  LAB_RESULTED: "lab.resulted",
  /** Any bill raised anywhere. */
  INVOICE_RAISED: "invoice.raised",
  /** Money taken against a bill - this is what clears a due. */
  PAYMENT_TAKEN: "payment.taken",
  /** Somebody was admitted to a bed. */
  ADMISSION_OPENED: "admission.opened",
  /** Somebody went home. Frees a bed, so the ward board must move. */
  ADMISSION_CLOSED: "admission.closed",
  /** The website asked us to ring somebody back. */
  CALLBACK_RAISED: "callback.raised",
  /** A delivery was booked in - stock levels and alerts change. */
  STOCK_RECEIVED: "stock.received",
  /** Stock adjusted or written off. */
  STOCK_CHANGED: "stock.changed",
  /**
   * A visit was booked, checked in, cancelled, rescheduled, or had its doctor
   * changed - anything that moves a patient through the day.
   *
   * One event rather than five, because every screen that cares re-fetches the
   * same list either way. The desk's Today board and the doctor's queue are two
   * views of one thing; a patient arriving at the counter has to appear in the
   * consulting room without anybody pressing anything.
   */
  APPOINTMENT_CHANGED: "appointment.changed",
  /** A consultation was marked done - the desk can close billing on it. */
  CONSULTATION_COMPLETED: "consultation.completed",
} as const;

export type LiveEvent = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * The whole payload. `at` exists so a client can ignore a straggler that arrives
 * after a newer one; `n` is an optional plain count (queue depth) which is a
 * number about the hospital, not about any person.
 */
export interface LiveSignal {
  event: LiveEvent;
  at: number;
  n?: number;
}

/** Channel names are namespaced so this project can share a Supabase instance. */
export const channelFor = (topic: Topic) => `jeeva:${topic}`;
