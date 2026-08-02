import type { IconName } from "@/components/portal/ui/icons";

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
  badge?: { path: string; field: string; tone?: "amber" | "rose" };
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
        badge: { path: "/reception/advised-labs?limit=1", field: "count", tone: "amber" },
      },
      { label: "Billing", href: "/billing", icon: "receipt" },
      { label: "Day close", href: "/day-close", icon: "trend" },
      { label: "Admissions", href: "/ipd", icon: "bed" },
      { label: "Patients", href: "/patients", icon: "search" },
      { label: "Schedule", href: "/schedule", icon: "clock" },
    ],

  },
  admin: {
    key: "admin",
    brand: "Jeeva",
    roleLabel: "Admin Console",
    nav: [
      { label: "Overview", href: "/", icon: "grid" },
      { label: "Appointments", href: "/appointments", icon: "calendar" },
      { label: "All bills", href: "/bills", icon: "receipt" },
      { label: "Insurance claims", href: "/insurance", icon: "shield" },
      { label: "Day close", href: "/day-close", icon: "rupee" },
      { label: "Accounts & GST", href: "/accounts", icon: "trend" },
      { label: "Pharmacy", href: "/pharmacy", icon: "pill" },
      { label: "HR & staff", href: "/hr", icon: "users" },
      { label: "Lab catalog & GST", href: "/catalog", icon: "flask" },
      { label: "Wards & beds", href: "/wards", icon: "bed" },
      { label: "Login activity", href: "/sessions", icon: "clock" },
      { label: "Audit log", href: "/audit", icon: "activity" },
      { label: "Errors", href: "/errors", icon: "alert" },
      { label: "Hospital settings", href: "/settings", icon: "building" },

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
            // An inpatient's medicine leaves unpaid by design. Without a number
            // sitting in the sidebar, nobody remembers to go and collect it.
            label: "Dues to collect", href: "/dues", icon: "rupee",

            badge: { path: "/pharmacy/dues", field: "count", tone: "amber" },
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