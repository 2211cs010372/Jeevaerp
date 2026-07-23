import type { IconName } from "@/components/portal/ui/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** One line telling a new staff member WHY they'd click this. */
  hint?: string;
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
      { label: "Register patient", href: "/register", icon: "users" },
      { label: "Book appointment", href: "/book", icon: "calendar" },
      { label: "Prescriptions", href: "/prescriptions", icon: "file" },
      { label: "Lab tests", href: "/labs", icon: "flask" },
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
      { label: "HR & staff", href: "/hr", icon: "users" },
      { label: "Lab catalog & GST", href: "/catalog", icon: "flask" },
      { label: "Wards & beds", href: "/wards", icon: "bed" },
      { label: "Hospital settings", href: "/settings", icon: "building" },
      { label: "Login activity", href: "/sessions", icon: "clock" },
      { label: "Audit log", href: "/audit", icon: "activity" },
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
    ],
    groups: [
      {
        title: "At the counter",
        items: [
          { label: "Dashboard", href: "/", icon: "grid", hint: "Today's takings and what's waiting." },
          { label: "Prescriptions", href: "/queue", icon: "file", hint: "Chits sent up by reception. Dispense them." },
          { label: "Dispense", href: "/dispense", icon: "pill", hint: "Walk-in sale. No prescription needed." },
        ],
      },
      {
        title: "The shelf",
        items: [
          { label: "Stock", href: "/stock", icon: "grid", hint: "What's on the rack. Add, edit, write off." },
          { label: "Alerts", href: "/alerts", icon: "alert", hint: "Running low, expiring, or expired." },
        ],
      },
      {
        // Stock used to only ever go DOWN. This group is how it comes back in -
        // in the order you actually do it: decide, order, receive, send back.
        title: "Buying it in",
        items: [
          { label: "Reorder", href: "/reorder", icon: "trend", hint: "What to buy, priced and grouped by supplier." },
          { label: "Purchase orders", href: "/purchase-orders", icon: "file", hint: "What's on order and what's overdue." },
          { label: "Receive goods", href: "/receive", icon: "inbox", hint: "Book in a delivery against its invoice." },
          { label: "Returns", href: "/returns", icon: "undo", hint: "Expiry credit owed by distributors." },
          { label: "Suppliers", href: "/suppliers", icon: "truck", hint: "Distributors, licences and terms." },
        ],
      },
    ],
  },
};