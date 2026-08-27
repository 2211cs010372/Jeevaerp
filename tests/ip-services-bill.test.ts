import { describe, it, expect } from "vitest";
import { bucketOfSection, isDiscountable, ipServicesBill } from "@/lib/ip-services-bill";

/**
 * The thing this pins down: a self-paying family is given a discount on the
 * hospital's OWN services and not on their medicines or their tests, and the
 * money they already handed over at the pharmacy window has to come off what is
 * asked for at discharge. Get either half wrong and the desk either gives away
 * the pharmacy's margin or charges for a strip of tablets twice.
 */

const SECTIONS = [
  { title: "HOSPITAL SERVICES", total: "40000.00" },
  { title: "CONSULTATION CHARGES", total: "6000.00" },
  { title: "LAB INVESTIGATION CHARGES", total: "5000.00" },
  { title: "PHARMACY CHARGES", total: "9000.00" },
];

describe("bucketOfSection - which block a heading belongs to", () => {
  it("files the hospital's own headings under SERVICES", () => {
    expect(bucketOfSection("HOSPITAL SERVICES")).toBe("SERVICES");
    expect(bucketOfSection("CONSULTATION CHARGES")).toBe("SERVICES");
    expect(bucketOfSection("DOCTOR VISITING CHARGES")).toBe("SERVICES");
  });

  it("files tests and medicines under their own counters", () => {
    expect(bucketOfSection("LAB INVESTIGATION CHARGES")).toBe("LAB");
    expect(bucketOfSection("INVESTIGATIONS")).toBe("LAB");
    expect(bucketOfSection("PHARMACY CHARGES")).toBe("PHARMACY");
  });

  it("matches on the words, so a reworded heading keeps its block", () => {
    // The headings are composed in ipd.service. An exact-match table would make
    // a renamed section silently discountable.
    expect(bucketOfSection("Pharmacy / medicines dispensed")).toBe("PHARMACY");
    expect(bucketOfSection("Diagnostics")).toBe("LAB");
  });

  it("only SERVICES may be discounted", () => {
    expect(isDiscountable("SERVICES")).toBe(true);
    expect(isDiscountable("LAB")).toBe(false);
    expect(isDiscountable("PHARMACY")).toBe(false);
  });
});

describe("ipServicesBill - the discount lands on services alone", () => {
  it("takes the whole discount off services and leaves lab and pharmacy at cost", () => {
    const b = ipServicesBill({ sections: SECTIONS, discount: 6000 });

    expect(b.services.gross).toBe(46000);
    expect(b.services.discount).toBe(6000);
    expect(b.services.net).toBe(40000);

    expect(b.lab.gross).toBe(5000);
    expect(b.lab.discount).toBe(0);
    expect(b.lab.net).toBe(5000);

    expect(b.pharmacy.gross).toBe(9000);
    expect(b.pharmacy.discount).toBe(0);
    expect(b.pharmacy.net).toBe(9000);

    expect(b.gross).toBe(60000);
    expect(b.netBill).toBe(54000);
    expect(b.netPayable).toBe(54000);
  });

  it("puts GST on the services block, where the stay's invoice raised it", () => {
    const b = ipServicesBill({ sections: SECTIONS, discount: 1000, gst: 500 });
    expect(b.services.net).toBe(45500); // 46000 − 1000 + 500
    expect(b.netBill).toBe(59500);
  });

  it("CAPS a discount bigger than the services block instead of spreading it", () => {
    // 50,000 agreed against 46,000 of hospital services. The 4,000 overflow is
    // NOT taken off the medicines - it is reported so the sheet can say so.
    const b = ipServicesBill({ sections: SECTIONS, discount: 50000 });
    expect(b.services.discount).toBe(46000);
    expect(b.services.net).toBe(0);
    expect(b.discountUnapplied).toBe(4000);
    expect(b.pharmacy.net).toBe(9000);
    expect(b.lab.net).toBe(5000);
    expect(b.netPayable).toBe(14000);
  });
});

describe("ipServicesBill - money already taken comes off what is asked for", () => {
  it("credits each counter's own payments to its own block", () => {
    const b = ipServicesBill({
      sections: SECTIONS,
      discount: 6000,
      paid: { lab: 5000, pharmacy: 4000 },
    });

    expect(b.lab.paid).toBe(5000);
    expect(b.lab.due).toBe(0);
    expect(b.lab.settled).toBe(true);

    expect(b.pharmacy.paid).toBe(4000);
    expect(b.pharmacy.due).toBe(5000);
    expect(b.pharmacy.settled).toBe(false);

    expect(b.paidTotal).toBe(9000);
    // 54,000 billed, 9,000 already in the drawer.
    expect(b.netPayable).toBe(45000);
  });

  it("does not let an overpaid pharmacy bill pay down the bed", () => {
    const b = ipServicesBill({
      sections: SECTIONS,
      discount: 0,
      paid: { pharmacy: 12000 },
    });
    // 9,000 of medicines, 12,000 handed over. Only 9,000 is credited here; the
    // 3,000 is the pharmacy's to refund, not the ward's to spend.
    expect(b.pharmacy.paid).toBe(9000);
    expect(b.pharmacy.due).toBe(0);
    expect(b.services.due).toBe(46000);
    expect(b.netPayable).toBe(51000); // 46,000 + 5,000 lab
  });

  it("credits money taken against the stay's own invoice to services", () => {
    const b = ipServicesBill({
      sections: SECTIONS,
      discount: 6000,
      paid: { services: 40000, lab: 5000, pharmacy: 9000 },
    });
    expect(b.services.due).toBe(0);
    expect(b.dueBeforeAdvance).toBe(0);
    expect(b.netPayable).toBe(0);
  });
});

describe("ipServicesBill - the deposit comes off last", () => {
  it("applies the advance to what is left after every counter payment", () => {
    const b = ipServicesBill({
      sections: SECTIONS,
      discount: 6000,
      advance: 20000,
      paid: { lab: 5000, pharmacy: 9000 },
    });
    expect(b.paidTotal).toBe(14000);
    expect(b.dueBeforeAdvance).toBe(40000);
    expect(b.advanceApplied).toBe(20000);
    expect(b.netPayable).toBe(20000);
    expect(b.refundDue).toBe(0);
  });

  it("hands back a deposit bigger than the balance rather than keeping it", () => {
    const b = ipServicesBill({
      sections: SECTIONS,
      discount: 6000,
      advance: 60000,
      paid: { lab: 5000, pharmacy: 9000 },
    });
    expect(b.advanceApplied).toBe(40000);
    expect(b.netPayable).toBe(0);
    expect(b.refundDue).toBe(20000);
  });

  it("never reports a refund while a counter is still owed", () => {
    // The deposit is 10,000 and the pharmacy is owed 9,000: nothing to hand back.
    const b = ipServicesBill({
      sections: SECTIONS,
      discount: 46000,
      advance: 10000,
      paid: { lab: 5000 },
    });
    expect(b.services.due).toBe(0);
    expect(b.pharmacy.due).toBe(9000);
    expect(b.advanceApplied).toBe(9000);
    expect(b.netPayable).toBe(0);
    expect(b.refundDue).toBe(1000);
  });
});

describe("ipServicesBill - the awkward inputs", () => {
  it("accepts the DTO's strings as readily as numbers", () => {
    const b = ipServicesBill({
      sections: [{ title: "HOSPITAL SERVICES", total: "1234.56" }],
      discount: "234.56",
      advance: "100",
    });
    expect(b.services.net).toBe(1000);
    expect(b.netPayable).toBe(900);
  });

  it("reads a stay with nothing on it as zero, not NaN", () => {
    const b = ipServicesBill({ sections: [], discount: 0 });
    expect(b.gross).toBe(0);
    expect(b.netBill).toBe(0);
    expect(b.netPayable).toBe(0);
    expect(b.refundDue).toBe(0);
  });

  it("ignores a negative discount rather than adding it to the bill", () => {
    const b = ipServicesBill({ sections: SECTIONS, discount: -5000 });
    expect(b.discount).toBe(0);
    expect(b.netBill).toBe(60000);
  });

  it("keeps the paise, and adds them up the same way the invoice does", () => {
    const b = ipServicesBill({
      sections: [
        { title: "HOSPITAL SERVICES", total: "1000.10" },
        { title: "PHARMACY CHARGES", total: "20.25" },
      ],
      discount: "0.10",
      paid: { pharmacy: "20.25" },
    });
    expect(b.services.net).toBe(1000);
    expect(b.pharmacy.due).toBe(0);
    expect(b.netPayable).toBe(1000);
  });
});
