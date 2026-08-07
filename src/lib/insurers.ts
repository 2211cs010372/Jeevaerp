/**
 * The insurers and TPAs a hospital front office deals with most.
 *
 * Lives in lib rather than in the insurance service because the FRONT DESK needs
 * it now - the admission form asks who the insurer is, and importing a server
 * service into a client component to get a string array would drag Prisma into
 * the browser bundle.
 *
 * A suggestion list, never a constraint. Every field that uses it accepts a
 * free-typed name: a hospital meets a TPA that isn't on this list every few
 * months, and an admission must never be blocked because a dropdown is stale.
 */
export const INSURERS = [
  "Star Health", "HDFC ERGO", "ICICI Lombard", "Bajaj Allianz", "Care Health",
  "Niva Bupa", "New India Assurance", "United India Insurance", "Oriental Insurance",
  "National Insurance", "Aditya Birla Health", "Tata AIG", "SBI General",
  "Medi Assist (TPA)", "Paramount TPA", "Health India TPA", "Vidal Health (TPA)",
  "MDIndia (TPA)", "Family Health Plan (TPA)", "Aarogyasri (State scheme)", "CGHS", "ECHS",
] as const;
