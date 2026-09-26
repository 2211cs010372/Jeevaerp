import { describe, it, expect } from "vitest";

/**
 * Filter matching logic for IP Admissions.
 * Mirrors the exact contract used in InpatientsPage and currentInpatients.
 */
interface InpatientTestRow {
  ipNumber: string;
  admittedAt: string;
  status: string;
  attendantName: string | null;
  attendantPhone: string | null;
  patient: {
    displayId: string;
    fullName: string;
    phone: string;
  };
}

const sampleRows: InpatientTestRow[] = [
  {
    ipNumber: "JMH2026IP0001",
    admittedAt: "2026-09-20T10:00:00.000Z",
    status: "ADMITTED",
    attendantName: "Rajesh Sharma",
    attendantPhone: "9876500001",
    patient: {
      displayId: "JMH2026P0010",
      fullName: "Ananya Sharma",
      phone: "9123456780",
    },
  },
  {
    ipNumber: "JMH2026IP0002",
    admittedAt: "2026-09-22T14:30:00.000Z",
    status: "ADMITTED",
    attendantName: "Sunita Verma",
    attendantPhone: "9876500002",
    patient: {
      displayId: "JMH2026P0025",
      fullName: "Rahul Verma",
      phone: "9845012345",
    },
  },
  {
    ipNumber: "JMH2026IP0003",
    admittedAt: "2026-09-15T09:15:00.000Z",
    status: "DISCHARGED",
    attendantName: "Kavita Reddy",
    attendantPhone: "9876500003",
    patient: {
      displayId: "JMH2026P0033",
      fullName: "Suresh Reddy",
      phone: "9988776655",
    },
  },
];

function filterInpatients(
  rows: InpatientTestRow[],
  filters: {
    q?: string;
    searchField?: "ALL" | "MOBILE" | "IP" | "OP" | "NAME";
    fromDate?: string;
    toDate?: string;
    status?: "ADMITTED" | "DISCHARGED" | "ALL";
  }
) {
  const q = (filters.q || "").trim().toLowerCase();
  const searchField = filters.searchField || "ALL";

  return rows.filter((r) => {
    // 1. Status Filter
    if (filters.status === "ADMITTED" && r.status !== "ADMITTED") return false;
    if (filters.status === "DISCHARGED" && r.status === "ADMITTED") return false;

    // 2. Date Filter
    if (filters.fromDate || filters.toDate) {
      const rowDate = r.admittedAt.slice(0, 10);
      if (filters.fromDate && rowDate < filters.fromDate) return false;
      if (filters.toDate && rowDate > filters.toDate) return false;
    }

    // 3. Search Query
    if (!q) return true;
    const phone = (r.patient.phone || "").toLowerCase();
    const attendantPhone = (r.attendantPhone || "").toLowerCase();
    const ip = (r.ipNumber || "").toLowerCase();
    const op = (r.patient.displayId || "").toLowerCase();
    const name = (r.patient.fullName || "").toLowerCase();
    const attendantName = (r.attendantName || "").toLowerCase();

    if (searchField === "MOBILE") {
      return phone.includes(q) || attendantPhone.includes(q);
    }
    if (searchField === "IP") {
      return ip.includes(q);
    }
    if (searchField === "OP") {
      return op.includes(q);
    }
    if (searchField === "NAME") {
      return name.includes(q) || attendantName.includes(q);
    }

    return (
      phone.includes(q) ||
      attendantPhone.includes(q) ||
      ip.includes(q) ||
      op.includes(q) ||
      name.includes(q) ||
      attendantName.includes(q)
    );
  });
}

describe("IP Admissions search and filtering", () => {
  it("searches admitted patients by patient mobile number", () => {
    const res = filterInpatients(sampleRows, { q: "9845012345", status: "ADMITTED" });
    expect(res).toHaveLength(1);
    expect(res[0].patient.fullName).toBe("Rahul Verma");
  });

  it("searches admitted patients by attendant mobile number", () => {
    const res = filterInpatients(sampleRows, { q: "9876500001", status: "ADMITTED" });
    expect(res).toHaveLength(1);
    expect(res[0].patient.fullName).toBe("Ananya Sharma");
  });

  it("searches by IP number case-insensitively", () => {
    const res = filterInpatients(sampleRows, { q: "ip0002", status: "ADMITTED" });
    expect(res).toHaveLength(1);
    expect(res[0].ipNumber).toBe("JMH2026IP0002");
  });

  it("searches by OP number / UHID (patient.displayId)", () => {
    const res = filterInpatients(sampleRows, { q: "P0010", status: "ADMITTED" });
    expect(res).toHaveLength(1);
    expect(res[0].patient.displayId).toBe("JMH2026P0010");
  });

  it("searches by patient name", () => {
    const res = filterInpatients(sampleRows, { q: "rahul", status: "ADMITTED" });
    expect(res).toHaveLength(1);
    expect(res[0].patient.fullName).toBe("Rahul Verma");
  });

  it("filters by admission date range", () => {
    const res = filterInpatients(sampleRows, {
      fromDate: "2026-09-21",
      toDate: "2026-09-25",
      status: "ADMITTED",
    });
    expect(res).toHaveLength(1);
    expect(res[0].ipNumber).toBe("JMH2026IP0002");
  });

  it("filters by status: DISCHARGED and ALL", () => {
    const discharged = filterInpatients(sampleRows, { status: "DISCHARGED" });
    expect(discharged).toHaveLength(1);
    expect(discharged[0].patient.fullName).toBe("Suresh Reddy");

    const all = filterInpatients(sampleRows, { status: "ALL" });
    expect(all).toHaveLength(3);
  });

  it("supports targeted field search (e.g. MOBILE only)", () => {
    // Search query '98765' exists in both mobile and attendant phone, but not in OP or IP
    const res = filterInpatients(sampleRows, { q: "98765", searchField: "MOBILE", status: "ALL" });
    expect(res).toHaveLength(3);
  });
});
