import { describe, it, expect } from "vitest";
import {
  parseEmailList, parsePhoneList, rs, esc,
  renderReportHtml, renderReportText, renderNoticeHtml, renderNoticeText,
  renderWhatsAppText, whatsappReportVars, reportSubject,
  type DailyReport,
} from "@/lib/daily-report";

/**
 * A day with something in every column, so a renderer that drops a section
 * fails here rather than in somebody's inbox.
 */
function report(over: Partial<DailyReport> = {}): DailyReport {
  return {
    date: "2026-09-06",
    generatedAt: "2026-09-06T16:00:00.000Z",
    hospital: { name: "Jeeva Multispeciality Hospital" },
    money: {
      collected: 148500, refunded: 2500, net: 146000, cash: 51200,
      payments: 87, bills: 92, insuranceBills: 3, insuranceAmount: 141000,
      insurerReceipts: 160000,
      tills: [
        { label: "Reception", collected: 90000, refunded: 2500, net: 87500, cash: 30000, digital: 57500, bills: 51 },
        { label: "Pharmacy", collected: 58500, refunded: 0, net: 58500, cash: 21200, digital: 37300, bills: 41 },
      ],
      modes: [
        { mode: "CASH", collected: 53700, refunded: 2500, net: 51200, count: 44 },
        { mode: "UPI", collected: 94800, refunded: 0, net: 94800, count: 43 },
      ],
      bySource: [
        { source: "CONSULTATION", net: 40000, count: 30 },
        { source: "PHARMACY", net: 58500, count: 41 },
      ],
    },
    billing: {
      billed: 289000, billCount: 92, discountGiven: 4200,
      cancelled: 1, cancelledValue: 1800, dueFromToday: 7400, dueTotal: 214300,
    },
    opd: { booked: 63, completed: 58, cancelled: 4, newPatients: 11 },
    ipd: {
      admissions: 5, closures: 4,
      closureKinds: [{ status: "DISCHARGED", count: 3 }, { status: "LAMA", count: 1 }],
      inHouse: 27, beds: { total: 50, occupied: 27, free: 23 },
      advances: 34000, advanceCount: 4,
    },
    lab: { ordered: 41, completed: 36, pending: 9 },
    pharmacy: {
      sales: 58500, billCount: 41, profit: 9100, marginPct: 15.6,
      lowStock: 37, outOfStock: 6, expiringSoon: 12,
    },
    doctors: [{ doctor: "Dr Ravi Kumar", department: "General Medicine", visits: 22, revenue: 8800 }],
    insurance: { claimsRaised: 2, claimsRaisedValue: 141000, claimsSettled: 1, claimsSettledValue: 160000 },
    alerts: ["6 medicines are out of stock"],
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("parseEmailList - a list typed by whoever is at the desk", () => {
  it("accepts commas, semicolons, spaces and new lines in one go", () => {
    expect(parseEmailList("a@x.com, b@x.com;c@x.com\nd@x.com e@x.com"))
      .toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]);
  });

  it("de-duplicates case-insensitively - one inbox gets one copy", () => {
    // Owner@ and owner@ are the same mailbox. Two entries would send the day's
    // takings to that person twice every night.
    expect(parseEmailList("Owner@x.com, owner@x.com, OWNER@X.COM")).toEqual(["Owner@x.com"]);
  });

  it("drops junk rather than rejecting the whole list", () => {
    expect(parseEmailList("owner@x.com, and, -, accounts@x.com")).toEqual(["owner@x.com", "accounts@x.com"]);
  });

  it("is empty for null, undefined and blank", () => {
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList("   ")).toEqual([]);
  });
});

describe("parsePhoneList - stored form, and only real mobiles", () => {
  it("normalises every way a number gets typed to +91XXXXXXXXXX", () => {
    expect(parsePhoneList("9876543210, +91 98765 43211, 09876543212, 919876543213"))
      .toEqual(["+919876543210", "+919876543211", "+919876543212", "+919876543213"]);
  });

  it("de-duplicates across those spellings", () => {
    expect(parsePhoneList("9876543210, +919876543210, 09876543210")).toEqual(["+919876543210"]);
  });

  it("keeps the spaces inside a number and still splits the list", () => {
    // "+91 98765 43210" is one number written the way people write it. Splitting
    // on the spaces would leave three fragments, all dropped, and a recipient
    // who disappears with no error anywhere.
    expect(parsePhoneList("+91 98765 43210\n98765 43211")).toEqual(["+919876543210", "+919876543211"]);
  });

  it("still separates two numbers typed with only a space between them", () => {
    expect(parsePhoneList("9876543210 9876543211")).toEqual(["+919876543210", "+919876543211"]);
  });

  it("drops a landline whose leading digit gives it away", () => {
    // 040 is Hyderabad: the trunk 0 comes off and 4023456789 starts with a 4,
    // which no Indian mobile does. A 0870 landline is NOT caught - stripping its
    // 0 leaves 8702345678, which is indistinguishable from a mobile. The list
    // filters what is filterable and the send result names the rest.
    expect(parsePhoneList("04023456789, 9876543210")).toEqual(["+919876543210"]);
  });

  it("drops a number that is short, long, or starts below 6", () => {
    expect(parsePhoneList("98765, 98765432101234, 5876543210")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("rs - money as an Indian statement reads it", () => {
  it("groups in lakhs and drops the paise", () => {
    expect(rs(146000)).toBe("1,46,000");
    expect(rs(1234567.89)).toBe("12,34,568");
  });

  it("never renders NaN into a message", () => {
    // A missing figure must read as 0, not as "NaN" in fifteen inboxes.
    expect(rs(Number.NaN)).toBe("0");
    expect(rs(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("esc - staff-typed names cannot break the mail", () => {
  it("escapes the four characters that would eat a table row", () => {
    expect(esc(`A & B <script> "x"`)).toBe("A &amp; B &lt;script&gt; &quot;x&quot;");
  });

  it("keeps a stray angle bracket in a doctor name out of the markup", () => {
    const html = renderReportHtml(report({
      doctors: [{ doctor: "Dr <b>Ravi</b>", department: "Medicine", visits: 1, revenue: 500 }],
    }));
    expect(html).not.toContain("<b>Ravi</b>");
    expect(html).toContain("Dr &lt;b&gt;Ravi&lt;/b&gt;");
  });
});

// ---------------------------------------------------------------------------

describe("renderReportHtml - the complete statement", () => {
  const html = renderReportHtml(report());

  it("carries every section an owner is promised", () => {
    for (const heading of ["Money", "By counter", "By payment type", "Billing", "Outpatient", "Ward", "Laboratory", "Pharmacy", "Doctors", "Insurance"]) {
      expect(html).toContain(heading);
    }
  });

  it("shows insurer billing separately from collections", () => {
    // The number that must never be added into "collected": no drawer saw it.
    expect(html).toContain("Billed to insurers today");
    expect(html).toContain("1,41,000");
    expect(html).toContain("1,46,000");
  });

  it("names every kind of stay closure, not just discharges", () => {
    expect(html).toContain("3 discharged, 1 lama");
  });

  it("renders alerts when there are any, and no alert box when there are none", () => {
    expect(html).toContain("Needs attention");
    expect(renderReportHtml(report({ alerts: [] }))).not.toContain("Needs attention");
  });
});

describe("renderNoticeHtml / renderNoticeText - the covering letter", () => {
  it("is the letter the hospital dictated, in order", () => {
    const text = renderNoticeText(report());
    const order = [
      "Dear Admin,",
      "has been generated successfully by",
      "Please find the attached report below for your reference",
      "Kindly review the report and verify the details at your convenience",
      "Thank you for your time and attention",
      "Regards,",
      "Management",
    ];
    let at = -1;
    for (const line of order) {
      const next = text.indexOf(line);
      expect(next, line).toBeGreaterThan(at);
      at = next;
    }
  });

  it("fills the date placeholder with the day the report is FOR", () => {
    // Not "today": a report re-sent the next morning for a night the schedule
    // missed must still name the day it covers.
    expect(renderNoticeHtml(report({ date: "2026-09-05" }))).toContain("Sat, 5 Sep 2026");
    expect(renderNoticeText(report({ date: "2026-09-05" }))).toContain("Sat, 5 Sep 2026");
  });

  it("names the hospital from its own config, not a string typed into the mail", () => {
    // A covering letter that spells the hospital differently from the statement
    // it covers is the first thing a reader notices.
    const html = renderNoticeHtml(report({ hospital: { name: "Some Other Hospital" } }));
    expect(html).toContain("Some Other Hospital");
    expect(html).not.toContain("Jeeva");
  });

  it("does NOT repeat the statement the PDF already carries", () => {
    // The whole point of the letter: a body that has already rendered forty rows
    // of figures leaves an owner nothing to open, and the attachment - the copy
    // that prints and files - goes unread underneath it.
    const html = renderNoticeHtml(report());
    for (const section of ["By payment type", "Laboratory", "Doctors", "Insurance", "1,46,000"]) {
      expect(html).not.toContain(section);
    }
  });

  it("escapes a hospital name so it cannot break the letter", () => {
    expect(renderNoticeHtml(report({ hospital: { name: "A & B <i>" } }))).toContain("A &amp; B &lt;i&gt;");
  });

  it("has a text part - a mail without one scores as spam", () => {
    expect(renderNoticeText(report()).length).toBeGreaterThan(60);
  });
});

describe("renderReportText - the plain-text alternative", () => {
  it("is not empty and carries the headline numbers", () => {
    const text = renderReportText(report());
    expect(text).toContain("Jeeva Multispeciality Hospital");
    expect(text).toContain("1,46,000");
    expect(text).toContain("Cash in hand   Rs 51,200");
  });
});

// ---------------------------------------------------------------------------

describe("whatsappReportVars - the approved template's slots", () => {
  const vars = whatsappReportVars(report());

  it("fills exactly the ten slots the registered template declares, in order", () => {
    // The order trap: no provider checks that these line up with the template.
    // If this array is ever reordered, the template must be re-registered.
    expect(vars).toHaveLength(10);
    expect(vars[1]).toBe("1,46,000");  // collected
    expect(vars[2]).toBe("51,200");    // cash
    expect(vars[3]).toBe("2,89,000");  // billed
    expect(vars[4]).toBe("2,14,300");  // outstanding
    expect(vars[5]).toBe("63");        // OP
    expect(vars[6]).toBe("5");         // admissions
    expect(vars[7]).toBe("4");         // closures
  });

  it("has no newline, tab or run of spaces in any value - Meta rejects those", () => {
    for (const v of vars) {
      expect(v).not.toMatch(/[\n\r\t]/);
      expect(v).not.toMatch(/ {5}/);
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe("renderWhatsAppText - the phone-sized summary", () => {
  it("leads with the two numbers an owner opens the message for", () => {
    const text = renderWhatsAppText(report());
    expect(text).toContain("Collected: *Rs 1,46,000*");
    expect(text).toContain("cash Rs 51,200");
  });

  it("stays short enough to be read on a phone", () => {
    // Not a provider limit - a readability one. A wall of figures is not read.
    expect(renderWhatsAppText(report()).length).toBeLessThan(700);
  });

  it("omits the insurer line on a day with no insurer billing", () => {
    const text = renderWhatsAppText(report({ money: { ...report().money, insuranceAmount: 0 } }));
    expect(text).not.toContain("To insurers");
  });
});

describe("reportSubject", () => {
  it("puts the day and the two headline figures in the subject line", () => {
    const s = reportSubject(report());
    expect(s).toContain("6 Sep 2026");
    expect(s).toContain("₹1,46,000");
    expect(s).toContain("₹51,200");
  });
});
