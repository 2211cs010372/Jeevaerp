import type { IconName } from "@/components/portal/ui/icons";
import { EVENTS, type LiveEvent } from "@/lib/realtime/topics";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** One line telling a new staff member WHY they'd click this. */
  hint?: string;
  /**
   * A live count pinned to this row, polled by the shell.
   * `path` is an API path, `field` a numeric key on the response body.
   * Use it only for work that ROTS if unseen - money not collected, a patient
   * waiting. A badge on everything is a badge on nothing.
   */
  badge?: {
    path: string;
    field: string;
    tone?: "amber" | "rose";
    /**
     * Which events actually move this number. Without it the shell re-pulls
     * every badge on EVERY signal for the portal - and since the reception
     * topic carries an appointment event four times per patient, a badge
     * counting money would be re-fetched a few hundred times a day to display
     * the same figure. Name the events and the request stops happening.
     */
    events?: LiveEvent[];
  };
}

/**
 * Nav is grouped by the JOURNEY, not by the database.
 *
 * A flat list of nine links ("Today · Register · Book · Patients · Prescriptions
 * · Lab tests · Billing · Schedule · Admissions") is a filing cabinet: it tells a
 * new receptionist what exists, but nothing about what order to do it in. Grouped
 * under the moments of a patient's visit, the sidebar teaches the workflow just by
 * being read.
 */
export interface NavGroup {
  /** Where in the patient's journey this sits. */
  title: string;
  items: NavItem[];
}
export interface PortalMeta {
  key: string;
  brand: string;
  roleLabel: string;
  nav: NavItem[];        // flat - kept for active-route matching + mobile
  groups?: NavGroup[];   // the teaching structure
}

/** Nav + branding per portal subdomain. Hrefs are within the portal route group. */
export const PORTALS: Record<string, PortalMeta> = {
  reception: {
    key: "reception",
    brand: "Jeeva",
    roleLabel: "Front Desk",
    nav: [
      { label: "Today", href: "/", icon: "grid" },
      { label: "Callback requests", href: "/requests", icon: "clock", hint: "People the website asked us to ring back" },
      { label: "Register patient", href: "/register", icon: "users" },
      { label: "Book appointment", href: "/book", icon: "calendar" },
      { label: "Prescriptions", href: "/prescriptions", icon: "file" },
      {
        // A test the doctor advised that nobody ordered is work that ROTS if
        // unseen - exactly what this badge is reserved for. The doctor assumes
        // it was done and waits for a result that is never coming.
        label: "Lab tests", href: "/labs", icon: "flask",
        badge: {
          path: "/reception/advised-labs?limit=1", field: "count", tone: "amber",
          // Only ordering or declining a test moves this. Check-ins do not.
          events: [EVENTS.LAB_ORDERED],
        },
      },
      // Directly under Lab tests, because that is where a wrong rate is noticed:
      // the desk is mid-order, the price reads ₹0, and the fix is one link away
      // rather than a phone call to the bench. Every edit is audit-logged - see
      // the route's guard for why this desk is trusted with it.
      { label: "Lab test prices", href: "/prices", icon: "rupee" },
      { label: "Billing", href: "/billing", icon: "receipt" },
      { label: "Day close", href: "/day-close", icon: "trend" },
      { label: "Admissions", href: "/ipd", icon: "bed" },
      { label: "Patients", href: "/patients", icon: "search" },
      { label: "Schedule", href: "/schedule", icon: "clock" },
      // The roster the booking screen offers. Kept next to Schedule because the
      // two answer the same question from either end - who is available, and
      // who exists at all.
      { label: "Doctors", href: "/doctors", icon: "users", hint: "Add a doctor, or correct their details" },
    ],

  },
  admin: {
    key: "admin",
    brand: "Jeeva",
    roleLabel: "Admin Console",
    nav: [
      { label: "Overview", href: "/", icon: "grid" },
      { label: "Patients", href: "/patients", icon: "users" },
      { label: "Appointments", href: "/appointments", icon: "calendar" },
      { label: "All bills", href: "/bills", icon: "receipt" },
      { label: "Insurance claims", href: "/insurance", icon: "shield" },
      { label: "Day close", href: "/day-close", icon: "rupee" },
      { label: "Accounts & GST", href: "/accounts", icon: "trend" },
      { label: "Pharmacy", href: "/pharmacy", icon: "pill" },
      { label: "HR & staff", href: "/hr", icon: "users" },
      { label: "Lab catalog & GST", href: "/catalog", icon: "flask" },
      // Prices on their own screen, editable a column at a time. The catalogue
      // above edits one test in a dialog, which is right for one rate and wrong
      // for the forty the import left at ₹0.
      { label: "Lab test prices", href: "/prices", icon: "rupee" },
      { label: "Wards & beds", href: "/wards", icon: "bed" },
      { label: "Login activity", href: "/sessions", icon: "clock" },
      { label: "Audit log", href: "/audit", icon: "activity" },
      { label: "Errors", href: "/errors", icon: "alert" },
      { label: "Hospital settings", href: "/settings", icon: "building" },

    ],
  },
  insurance: {
    key: "insurance",
    brand: "Jeeva",
    roleLabel: "Insurance Desk",
    nav: [
      { label: "Dashboard", href: "/", icon: "grid" },
      {
        // The list this desk lives on. A cashless patient who was admitted this
        // morning and has no pre-auth by evening is the exact shape of work that
        // ROTS if unseen - the stay runs up a bill nobody has authorized, and by
        // discharge the insurer is entitled to refuse the lot.
        label: "To raise", href: "/pending", icon: "alert",
        badge: {
          path: "/insurance/pending?limit=1", field: "count", tone: "rose",
          // Only an admission or a discharge creates one of these. A claim being
          // submitted removes one, and that happens on this very screen.
          events: [EVENTS.ADMISSION_OPENED, EVENTS.ADMISSION_CLOSED],
        },
      },
      // The patient list, separate from the late list above. A stay whose
      // pre-auth is already submitted drops off "To raise" and would otherwise
      // have no route to its bill at all - and repricing and reprinting that
      // bill is most of this desk's work.

      { label: "Insurance stays", href: "/stays", icon: "bed", hint: "Everyone admitted on a policy" },
      // THE WARD ITSELF, not just this desk's slice of it. A family arriving
      // with a policy card is admitted here rather than queued at reception and
      // sent back for the pre-auth; and because a bed held by a self-paying
      // patient is just as unavailable, the board shows every bed and every
      // stay, not only the insured ones.
      { label: "Beds & admit", href: "/ipd", icon: "bed", hint: "The ward board - admit a patient and open any stay" },
      { label: "Claims", href: "/claims", icon: "shield", hint: "Everything raised, and where it stands with the insurer" },
      // The list every "Insurer / TPA" box in the building suggests from -
      // reception's admission form included. It was compiled into the app, so a
      // newly empanelled TPA could only be typed free-hand, differently each
      // time, and one insurer became three rows on the analytics board.
      { label: "Insurers & TPAs", href: "/insurers", icon: "box", hint: "The names every insurer box suggests" },
      {
        // The other end of a claim. "Approved" is not the end of the story -
        // REFUSED is, and a refusal leaves bills pointed at an insurer who has
        // already said no. Those are kept out of every dues list by design, so
        // without this screen nobody could see them and reception's instinct
        // (go and look in Billing) was guaranteed to find nothing.
        label: "Settle up", href: "/settlements", icon: "rupee",
        hint: "What the insurer's answer means for the money",
        badge: {
          path: "/insurance/settlements", field: "patientPaysCount", tone: "rose",
          // A decision recorded on this desk, or a bill moving, is what changes
          // this number. Both land as one of these.
          events: [EVENTS.INVOICE_RAISED, EVENTS.ADMISSION_CLOSED],
        },
      },
    ],
    groups: [
      {
        // Ordered the way the desk actually works: find what's new, then chase
        // what's already out. Not "claims" as one undifferentiated pile.
        title: "Today",
        items: [
          { label: "Dashboard", href: "/", icon: "grid" },
          {
            label: "To raise", href: "/pending", icon: "alert",
            badge: {
              path: "/insurance/pending?limit=1", field: "count", tone: "rose",
              events: [EVENTS.ADMISSION_OPENED, EVENTS.ADMISSION_CLOSED],
            },
          },
        ],
      },
      {
        title: "The patients",
        items: [
          { label: "Insurance stays", href: "/stays", icon: "bed" },
          { label: "Beds & admit stays", href: "/ipd", icon: "bed" },
        ],
      },
      {
        title: "With the insurer",
        items: [
          { label: "Claims", href: "/claims", icon: "shield" },
          { label: "Insurers & TPAs", href: "/insurers", icon: "box" },
          {
            // Last, because it is where a claim ENDS - and the only place the
            // consequence of a refusal is visible as money somebody must chase.
            label: "Settle up", href: "/settlements", icon: "rupee",
            badge: {
              path: "/insurance/settlements", field: "patientPaysCount", tone: "rose",
              events: [EVENTS.INVOICE_RAISED, EVENTS.ADMISSION_CLOSED],
            },
          },
        ],
      },
    ],
  },
  doctor: {
    key: "doctor",
    brand: "Jeeva",
    roleLabel: "Consulting Room",
    nav: [
      { label: "Today", href: "/", icon: "grid" },
      { label: "Patient chart", href: "/patients", icon: "search" },
    ],
  },
  labs: {
    key: "labs",
    brand: "Jeeva",
    roleLabel: "Laboratory",
    nav: [
      { label: "Dashboard", href: "/", icon: "grid" },
      { label: "Test queue", href: "/queue", icon: "flask" },
      { label: "Order tests", href: "/order", icon: "plus" },
      // The same rows admin edits under "Lab catalog & GST" - one record, two
      // doors. The bench keeps the names and the prices; admin keeps the tax.
      { label: "Test catalog", href: "/catalog", icon: "box" },
      // Every price in one editable column - the screen for correcting a lot of
      // them at once. Same rows as the catalogue, same door admin uses.
      { label: "Test prices", href: "/prices", icon: "rupee" },
      { label: "Billing", href: "/billing", icon: "rupee" },
      { label: "Invoices", href: "/invoices", icon: "receipt" },
      { label: "Day close", href: "/day-close", icon: "trend" },
      { label: "Patients", href: "/patients", icon: "search" },
    ],
  },
  pharmacy: {
    key: "pharmacy",
    brand: "Jeeva",
    roleLabel: "Pharmacy",
    nav: [
      { label: "Dashboard", href: "/", icon: "grid" },
      { label: "Prescriptions", href: "/queue", icon: "file" },
      { label: "Dispense", href: "/dispense", icon: "pill" },
      { label: "Bills", href: "/bills", icon: "receipt" },
      { label: "Stock", href: "/stock", icon: "grid" },
      { label: "Alerts", href: "/alerts", icon: "alert" },
      { label: "Reorder", href: "/reorder", icon: "trend" },
      { label: "Purchase orders", href: "/purchase-orders", icon: "file" },
      { label: "Receive goods", href: "/receive", icon: "inbox" },
      { label: "Returns", href: "/returns", icon: "undo" },
      { label: "Suppliers", href: "/suppliers", icon: "truck" },
      { label: "Dues to collect", href: "/dues", icon: "rupee" },
      { label: "Day close", href: "/day-close", icon: "trend" },
    ],
    groups: [
      {
        title: "At the counter",
        items: [
          { label: "Dashboard", href: "/", icon: "grid", },
          { label: "Prescriptions", href: "/queue", icon: "file", },
          { label: "Dispense", href: "/dispense", icon: "pill", },
          {
            // EVERY bill this counter raised, not only the unpaid ones. Dues
            // below answers "who still owes us"; this answers "what did we
            // charge them", which is the question a patient comes back with -
            // and which used to be answerable only from reception's screen.
            label: "Bills", href: "/bills", icon: "receipt",
          },
          {
            // An inpatient's medicine leaves unpaid by design. Without a number
            // sitting in the sidebar, nobody remembers to go and collect it.
            label: "Dues to collect", href: "/dues", icon: "rupee",

            badge: {
              path: "/pharmacy/dues", field: "count", tone: "amber",
              // A due appears when a ward bill is raised and clears when it is
              // paid. Nothing else on this topic changes the number.
              events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN],
            },
          },
          {
            label: "Day close", href: "/day-close", icon: "trend",

          },
        ],
      },
      {
        title: "The shelf",
        items: [
          { label: "Stock", href: "/stock", icon: "grid", },
          { label: "Alerts", href: "/alerts", icon: "alert", },
        ],
      },
      {
        // Stock used to only ever go DOWN. This group is how it comes back in -
        // in the order you actually do it: decide, order, receive, send back.
        title: "Buying it in",
        items: [
          { label: "Reorder", href: "/reorder", icon: "trend", },
          { label: "Purchase orders", href: "/purchase-orders", icon: "file", },
          { label: "Receive goods", href: "/receive", icon: "inbox", },
          { label: "Returns", href: "/returns", icon: "undo", },
          { label: "Suppliers", href: "/suppliers", icon: "truck", },
        ],
      },
    ],
  },
};