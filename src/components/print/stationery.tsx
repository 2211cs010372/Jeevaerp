"use client";

import { useState } from "react";

/**
 * Jeeva print stationery - one visual family for every paper the desk hands out.
 *
 * The geometry mirrors the referral sheet the client's world already uses
 * (doctor block left · hospital block right · patient strip · vitals strip ·
 * ruled clinical lines · Rx table with dosage + Telugu timing hints · solid
 * footer band), re-branded for Jeeva. Colours come from two CSS variables so
 * the whole stationery can be re-inked in one place if the client wants the
 * classic red/blue instead of teal/saffron.
 *
 * Print strategy: these pages render inside the portal shell, so @media print
 * hides everything except #print-sheet. A4 portrait, 10mm margins.
 */

export interface HospitalInfo {
  legalName: string; addressLine: string; city: string; state: string;
  stateCode: string; pincode: string; gstin: string | null; phone: string | null;
  /** Admin-uploaded logo (base64 data URI). Falls back to the shipped mark. */
  logoDataUrl?: string | null;
  /** Terms / refund policy the hospital wants at the foot of every bill. */
  invoiceFooterNote?: string | null;
}

export const PRINT_CSS = `
  .print-stage { --pr-primary: #0b5f55; --pr-accent: #c77d33; --pr-ink: #17211e; --pr-line: #b9c4c0;
    --pr-muted: #7d8b86; --pr-hair: #dfe6e3; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }
  #print-sheet { width: 210mm; min-height: 296mm; margin: 0 auto; background: #fff; color: var(--pr-ink);
    box-shadow: 0 8px 40px rgba(0,0,0,.18); padding: 10mm 11mm 0; display: flex; flex-direction: column;
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif; font-size: 11.5px; line-height: 1.45; }
  #print-sheet .rule { border-bottom: 1px solid var(--pr-line); }
  #print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }
  @media print {
    body * { visibility: hidden !important; }
    #print-sheet, #print-sheet * { visibility: visible !important; }
    #print-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; min-height: 0; margin: 0; box-shadow: none; padding: 0; }
    .print-stage { background: #fff; padding: 0; }
    @page { size: A4 portrait; margin: 10mm; }
  }
`;

/**
 * PRE-PRINTED STATIONERY (A4) - the profile used when the tray is loaded with
 * the hospital's own printed paper instead of blank stock.
 *
 * That paper already carries, in ink, the things a generated header would
 * duplicate: logo top-left, JEEVA wordmark top-right, and the address / phone
 * band plus the location QR at the foot. So the app must print INTO the gap
 * between them and nowhere else.
 *
 * The reserved bands below are measured off the stationery scan (A4 =
 * 210 x 297 mm):
 *
 *   top    logo + wordmark ink ends at ~37 mm   -> 40 mm of head room
 *   bottom QR + pin start at ~251 mm, address
 *          band at ~285 mm                      -> 46 mm of foot room
 *   sides  13 mm, inside the printed rule
 *
 * @page margin is forced to 0 and every offset comes from #print-sheet padding,
 * so the landing position is the same whatever margin the browser's print
 * dialog defaults to - a 10 mm browser margin would otherwise have pushed the
 * whole sheet down into the doctor's writing space.
 */
export const STATIONERY_PRINT_CSS = `
  .print-stage { --pr-primary: #0b5f55; --pr-accent: #c77d33; --pr-ink: #17211e; --pr-line: #b9c4c0;
    --pr-muted: #7d8b86; --pr-hair: #dfe6e3; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }
  #print-sheet { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff;
    color: var(--pr-ink); box-shadow: 0 8px 40px rgba(0,0,0,.18); padding: 40mm 13mm 46mm;
    display: flex; flex-direction: column;
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 11.5px; line-height: 1.45; }
  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    #print-sheet, #print-sheet * { visibility: visible !important; }
    .print-stage { background: #fff !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }
    @page { size: A4 portrait; margin: 0; }
    #print-sheet { position: absolute; inset: 0 auto auto 0; width: 210mm; min-height: 297mm;
      margin: 0; box-shadow: none; padding: 40mm 13mm 46mm; }
    .screen-only { display: none !important; }
  }
`;

/**
 * SEVERAL SHEETS, ONE PRINT JOB.
 *
 * One sample can carry four tests, and each is its own report - its own
 * department band, its own signature, its own "End of report". Printed one at a
 * time that is four visits to the print dialog, and the fourth is the one that
 * doesn't happen: the patient walks out with three of their four results.
 *
 * So the order prints as ONE document with a hard page break after every test.
 * The page count follows the work - two tests, two pages; four, four - and a
 * test whose analyte list runs long keeps its own sheet either way.
 *
 * Two differences from the single-report profiles above, both forced by there
 * being more than one page:
 *
 *   * `.print-sheet`, a CLASS, not the `#print-sheet` id - an id can only ever
 *     name one element, and this document has N.
 *   * Sheets sit in normal flow with a fixed page height and `break-after`,
 *     where a single sheet is pinned with position:absolute. Absolute pinning
 *     is what confines that one to a single page; here it would stack every
 *     report on top of the first.
 *
 * The height is 296.8mm rather than a round 297: browsers round page geometry
 * in device pixels, and a box exactly as tall as the paper rounds UP often
 * enough to emit a blank sheet between every report.
 */
export function multiSheetPrintCss(onStationery: boolean): string {
  // Same reserved bands as STATIONERY_PRINT_CSS - see its note for the
  // measurements off the stationery scan.
  const pad = onStationery ? "40mm 13mm 46mm" : "10mm 11mm";
  return `
  .print-stage { --pr-primary: #0b5f55; --pr-accent: #c77d33; --pr-ink: #17211e; --pr-line: #b9c4c0;
    --pr-muted: #7d8b86; --pr-hair: #dfe6e3; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }
  .print-sheet { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto 22px; background: #fff;
    color: var(--pr-ink); box-shadow: 0 8px 40px rgba(0,0,0,.18); padding: ${pad};
    display: flex; flex-direction: column;
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 11.5px; line-height: 1.45; }
  .print-sheet .rule { border-bottom: 1px solid var(--pr-line); }
  .print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }
  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    .print-sheet, .print-sheet * { visibility: visible !important; }
    .print-stage { background: #fff !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }
    @page { size: A4 portrait; margin: 0; }
    .print-sheet { width: 210mm; height: 296.8mm; min-height: 0; margin: 0; box-shadow: none;
      padding: ${pad}; overflow: hidden; break-inside: avoid; }
    /* The break goes BEFORE each sheet after the first, not after every sheet:
       a break after the last one is a blank sheet, and "after every sheet
       except the last" is a rule that only holds while nothing else is ever
       rendered below them. */
    .print-sheet + .print-sheet { break-before: page; page-break-before: always; }
    .screen-only { display: none !important; }
  }
`;
}

/**
 * A5 invoice stationery.
 *
 * The bill is printed on A5 (148 × 210 mm) - half a sheet, the size a pharmacy
 * or hospital counter actually runs its bill printer at. Two things follow from
 * that and from the client's ask:
 *
 *  1. NO letterhead image. The masthead is set in TEXT (name · GSTIN · address ·
 *     phone), so it prints crisp on a thermal/laser A5 and needs no asset.
 *  2. It PAGINATES. A long inpatient bill won't fit on one A5, so the sheet
 *     flows in normal document order (not pinned with position:absolute, which
 *     clips to a single page) and the table header repeats on each sheet. Rows
 *     never split across the fold (break-inside:avoid).
 *
 * Because the /print routes render bare (no portal shell), normal flow starts at
 * the top of the page with no offset.
 */
export const INVOICE_PRINT_CSS = `
  .print-stage { --pr-primary: #0b5f55; --pr-accent: #c77d33; --pr-ink: #17211e; --pr-line: #b9c4c0; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }
  
  #print-sheet { 
    width: 148mm; 
    margin: 0 auto; 
    background: #fff; 
    color: var(--pr-ink);
    box-shadow: 0 8px 40px rgba(0,0,0,.18); 
    padding: 8mm 9mm;
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 9.7px; 
    line-height: 1.42; 
  }
  
  #print-sheet .rule { border-bottom: 0.5px solid var(--pr-line); }
  #print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }
  
  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    #print-sheet, #print-sheet * { visibility: visible !important; }
    
    .print-stage { background: #fff !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }
    
    @page { 
      size: 148mm 210mm; /* Explicitly define exact A5 dimensions */
      margin: 0mm;       /* Strip all browser-injected margins */
    }
    
    #print-sheet { 
      position: static !important; 
      width: 148mm !important; /* Force exact A5 width */
      margin: 0 !important; 
      box-shadow: none !important; 
      padding: 8mm 9mm !important; /* Your internal margins are handled via padding */
    }
    
    thead { display: table-header-group; }  
    tr { break-inside: avoid; }
    .keep-together { break-inside: avoid; }
  }
`;

/**
 * Text masthead for the bill - the replacement for the photographed letterhead.
 * Name large, then GSTIN, address and phone as plain lines. Falls back to the
 * hospital's real details when Hospital settings aren't loaded, so a bill never
 * prints anonymous.
 */
export function BillHead({ hospital }: { hospital: HospitalInfo | null }) {
  const name = hospital?.legalName ?? "Jeeva Multispeciality Hospital";
  const address = hospital
    ? `${hospital.addressLine}, ${hospital.city}, ${hospital.state} – ${hospital.pincode}`
    : "# 1-8-81, Sai Nagar, Beside Swimming Pool, Balasamudram, Hanamkonda, Telangana – 506 001";
  const phone = hospital?.phone ?? "9704691308";
  return (
    <div className="keep-together rule-strong pb-2 text-center">
      <div className="text-[17px] font-extrabold uppercase leading-tight tracking-tight" style={{ color: "var(--pr-primary)" }}>
        {name}
      </div>
      <div className="mt-1 text-[9px] font-medium leading-snug text-[#2b3a35]">{address}</div>
      <div className="mt-0.5 flex items-center justify-center gap-x-3 gap-y-0.5 text-[9px] font-semibold text-[#2b3a35]">
        {hospital?.gstin && <span>GSTIN: <span className="font-mono">{hospital.gstin}</span></span>}
        <span>Phone: <span className="font-mono">{phone}</span></span>
      </div>
    </div>
  );
}

/** Screen-only toolbar; vanishes in print. */
export function PrintToolbar({ title }: { title: string }) {
  return (
    <div className="mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between print:hidden">
      <p className="text-[13px] font-medium text-[#5a6a66]">{title}</p>
      <div className="flex gap-2">
        <button onClick={() => history.back()}
          className="rounded-lg border border-[#c8ccc9] bg-white px-4 py-2 text-[13px] font-medium text-[#3a4744] hover:border-[#0b5f55] hover:text-[#0b5f55]">
          ← Back
        </button>
        <button onClick={() => window.print()}
          className="rounded-lg bg-[#0b5f55] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#084a42]">
          Print / Save PDF
        </button>
      </div>
    </div>
  );
}

/**
 * Letterhead - the actual photographed hospital stationery (logo, wordmark,
 * phone, address, closing rule all baked into one image at
 * /public/images/jeeva-header.jpg), bled edge-to-edge like the FooterBand.
 * This is real ink from the real letterhead, not a redrawn approximation -
 * so it prints correctly even if Hospital settings are ever out of sync.
 *
 * The consulting doctor, when given, prints as a slim line under the image
 * - the photo itself is one generic header used for every doctor, so their
 * name is the one thing added per-sheet, not per-press-run.
 *
 * If the image is ever missing (fresh checkout, asset not deployed yet) this
 * falls back to a hand-coded reconstruction from Hospital settings, so the
 * sheet still prints something usable instead of a broken image icon.
 */
export function LetterHead({ hospital, doctor }: {
  hospital: HospitalInfo | null;
  doctor?: { name: string; specialization: string; department: string } | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = (hospital?.legalName ?? "Jeeva Multi Speciality Hospital").toUpperCase();
  const addressLine = hospital
    ? `${hospital.addressLine}, ${hospital.city}, ${hospital.state} – ${hospital.pincode}.`
    : "# 1-8-81, Sai Nagar, Beside Swimming Pool, Balasamudram, Hanamkonda, Telangana – 506 001.";
  const phone = hospital?.phone ?? "9704691308";

  if (imgFailed) {
    return (
      <div className="rule-strong pb-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* The hospital's own logo when an admin has set one under Settings,
                otherwise the shipped mark. Not next/image: a data URI has
                nothing for the optimiser to fetch or resize. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hospital?.logoDataUrl || "/images/jeeva-logo.png"} alt={name}
              className="h-[44px] w-[44px] shrink-0 object-contain" />
            <div className="min-w-0 text-[22px] font-extrabold uppercase leading-[1.05] tracking-tight" style={{ color: "#c8211b" }}>
              {name}
            </div>
          </div>
          <div className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-[#1f2937]">Cell : {phone}</div>
        </div>
        <div className="mt-1 text-center text-[10.5px] font-medium leading-snug text-[#1f2937]">{addressLine}</div>
        {doctor && (
          <div className="mt-1 text-center text-[10px] font-semibold" style={{ color: "var(--pr-primary)" }}>
            Dr. {doctor.name} · {doctor.specialization} · Department of {doctor.department}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rule-strong w-full  flex items-end justify-between  h-full  pb-2">

      <div className="w-[800px]" style={{ margin: "0 -11mm" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/jeeva-header.jpeg"
          alt={name}
          style={{ width: "100%", display: "block" }}
          onError={() => setImgFailed(true)}
        />
      </div>

    </div>
  );
}

/**
 * Visit classification band - the first thing a nurse or a medico-legal reader
 * looks for on a casualty sheet.
 *
 * Two things it must survive:
 *
 *  1. PRINT. Browsers drop background colours by default, which would have left
 *     white-on-white - i.e. an emergency sheet that looks like a routine one.
 *     `print-color-adjust: exact` forces the ink, and the border + dark text
 *     mean it still reads as EMERGENCY on a mono laser that ignores the hint.
 *  2. THE PAGE. It sits in normal flow above the patient strip, not absolutely
 *     positioned over it - an overlay landed on top of the Date column.
 */
export function VisitTypeBand({ type }: { type?: string | null }) {
  const norm = (type || "OP").toUpperCase();
  const isEmerg = norm === "EMERGENCY" || norm === "CASUALTY";
  const isIp = norm === "IP" || norm === "IPD" || norm === "INPATIENT";

  // Routine OP is stamped in the sheet's own teal rather than suppressed: the
  // band is a classification every sheet carries, so its ABSENCE can't be read
  // as "routine" - a missing band would just mean nobody printed one.
  const bg = isEmerg ? "#c8211b" : isIp ? "#1d4ed8" : "#0b5f55";
  const label = norm === "CASUALTY" ? "CASUALTY OP" : isEmerg ? "EMERGENCY OP" : isIp ? "INPATIENT (IP)" : "OUTPATIENT (OP)";
  const note = isEmerg ? "Attended in casualty · seen on arrival, no prior appointment" : null;

  return (
    <div className="mt-2 flex items-center gap-2">
      <span
        className="inline-flex items-center justify-center rounded-sm border px-2.5 py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white"
        style={{
          backgroundColor: bg,
          borderColor: bg,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        {label}
      </span>
      {note && <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: bg }}>{note}</span>}
    </div>
  );
}

/** The two-row patient strip every document opens with. */
export function PatientStrip({ cells, doctor }: {
  cells: { k: string; v: string; grow?: boolean; mono?: boolean; pen?: boolean }[];
  doctor?: { name: string; specialization: string; department: string } | null;
}) {
  return (
    <div
      className=" grid items-baseline gap-x-6 gap-y-1 py-0.8 mt-3 text-[13px]"
      style={{ gridTemplateColumns: cells.map((c) => (c.grow ? "minmax(0,2.1fr)" : "minmax(0,1fr)")).join(" ") }}
    >
      {cells.map((c, i) => (
        <div key={i} className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-semibold uppercase tracking-wide text-[9px] text-[#57655f]">{c.k}</span>
          {c.pen ? (
            /* an intentional writing line - a blank pad cell, not missing data */
            <span className="inline-block w-full border-b border-[var(--pr-line)]">&nbsp;</span>
          ) : (
            <span className={`truncate font-medium text-[var(--pr-ink)] ${c.mono ? "font-mono" : ""}`}>{c.v || "-"}</span>
          )}
        </div>
      ))}
      {doctor && (
        <div className="mt-1 text-start text-[10px] font-semibold" style={{ color: "var(--pr-primary)" }}>
          <span className="font-bold tracking-tighter text-[25px] flex flex-col leading-[0.8] justify-start text-start "> {doctor.name}</span> <br /> · <span className="font-medium text-[21px] tracking-tighter leading-[0.8]">{doctor.specialization}</span> <br /> · Department of {doctor.department}
        </div>
      )}
    </div>
  );
}

/**
 * A labelled line with the typed value printed over the rule - the
 * computerized twin of RuledLine. Falls back to a blank pen line when
 * nothing was typed, so the sheet reads the same either way.
 */
export function FilledLine({ label, value, trailing }: { label: string; value?: string | null; trailing?: string }) {
  if (!value?.trim()) return <RuledLine label={label} trailing={trailing} />;
  return (
    <div className="py-3">
      <div className="flex items-end gap-2">
        <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-[#3c4a45]">{label}</span>
        <span className="rule flex-1 pb-0.5 text-[12px] font-semibold leading-snug" style={{ color: "var(--pr-primary)" }}>
          {value}
        </span>
        {trailing && <span className="text-[9px] text-[#6b7772]">{trailing}</span>}
      </div>
    </div>
  );
}

/**
 * Prescribed lab investigations - a numbered list in the sheet's own ink,
 * two columns when the list is long. Advisory text for the patient and the
 * lab counter; actual lab ORDERS are LabTest rows on the visit.
 */
export function LabList({ tests }: { tests: string[] }) {
  if (!tests.length) return null;
  return (
    <div className="py-3">
      <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
        Lab investigations advised
      </p>
      <ol className={`mt-1.5 grid gap-x-8 gap-y-1 text-[12px] ${tests.length > 4 ? "grid-cols-2" : "grid-cols-1"}`}>
        {tests.map((t, i) => (
          <li key={i} className="flex items-baseline gap-2 border-b border-[var(--pr-line)] pb-1">
            <span className="font-mono text-[10px]" style={{ color: "var(--pr-primary)" }}>{i + 1}.</span>
            <span className="font-semibold text-[var(--pr-ink)]">{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A labelled hand-fill line, e.g. "DIAGNOSIS ______________". */
export function RuledLine({ label, lines = 1, trailing }: { label: string; lines?: number; trailing?: string }) {
  return (
    <div className="py-5">
      <div className="flex items-end gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-wide text-[#3c4a45]">{label}</span>
        <span className="rule mb-0.5 flex-1" />
        {trailing && <span className="text-[9px] text-[#6b7772]">{trailing}</span>}
      </div>
      {Array.from({ length: lines - 1 }).map((_, i) => <div key={i} className="rule h-[28px]" />)}
    </div>
  );
}

/**
 * The ℞ table - medicines as reception typed them while sending to pharmacy.
 * This is the same data, read straight back out: no separate "prescription
 * document" exists anywhere else. Dosage is split on the fly - "1-0-1 after
 * food" becomes the 1-0-1 pattern in its own column and "after food" in
 * Timing & duration - because that's the one typing convention reception
 * already uses in the /prescriptions form.
 *
 * blankRows pads the table out to a fixed row count so a light Rx doesn't
 * leave a half-empty sheet; pass 0 to print exactly the entered rows.
 */
export function RxTable({ items, blankRows = 0, note }: {
  items: { medicineName: string; qty: number; dosage: string | null }[];
  blankRows?: number;
  note?: string;
}) {
  return (
    <div className="mt-2 flex-none">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[9.5px] uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
            <th className="w-[66px] text-[38px] border-y-2 py-1.5 pr-1 font-bold" style={{ borderColor: "var(--pr-primary)" }}>℞</th>
            <th className="border-y-2 py-1.5 pr-2 font-bold" style={{ borderColor: "var(--pr-primary)" }}>Medicine</th>
            <th className="w-[86px] border-y-2 py-1.5 pr-2 font-bold" style={{ borderColor: "var(--pr-primary)" }}>Dosage<br /><span className="font-medium normal-case text-[#57655f]">ఉ – మ – రా</span></th>
            <th className="w-[190px] border-y-2 py-1.5 font-bold" style={{ borderColor: "var(--pr-primary)" }}>Timing & duration<br /><span className="font-medium normal-case text-[#57655f]">భోజనం ముందు / తర్వాత</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            // "1-0-0 after food 1 month" -> dosage pattern into its column, rest into timing
            const dosage = it.dosage?.trim() ?? "";
            const m = dosage.match(/^([0-9]+(?:\/[0-9]+)?\s*[-–]\s*[0-9]+(?:\/[0-9]+)?\s*[-–]\s*[0-9]+(?:\/[0-9]+)?)\s*(.*)$/);
            const pattern = m ? m[1].replace(/\s/g, "") : "";
            const timing = m ? m[2] : dosage;
            return (
              <tr key={i} className="align-top" style={{ color: "var(--pr-primary)" }} >
                <td className=" py-[7px] pr-1 font-mono text-[11px] text-[#57655f]">{i + 1}.</td>
                <td className=" py-[7px] pr-2 font-bold">{it.medicineName}{it.qty > 1 ? <span className="ml-1 font-normal text-[#57655f]">× {it.qty}</span> : null}</td>
                <td className=" py-[7px] pr-2 font-mono">{pattern || "-"}</td>
                <td className=" py-[7px]">{timing || ""}</td>
              </tr>
            );
          })}
          {Array.from({ length: blankRows }).map((_, i) => (
            <tr key={`b${i}`}>
              <td className=" py-[13px] pr-1 font-mono text-[11px] text-[#8b9691]">{items.length + i + 1}.</td>
              <td className="" /><td className="" /><td className="" />
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 0 && note && <p className="mt-1 text-[8.5px] text-[#6b7772]">{note}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-PRINTED STATIONERY BLOCKS
//
// The rule the client set: no writing rules, no filled boxes, no stamps. Every
// field used to sit on an underline and the loud things sat in tinted cells and
// coloured pills - and on paper that already carries a logo, a wordmark, a
// watermark and a footer band, all of that read as a form to be argued with
// rather than a sheet to be written on.
//
// So the sheet carries no ink of its own beyond type, one hairline weight and
// space. What replaces the boxes is a three-voice hierarchy, held to by every
// block below:
//
//   CAPS + teal   structure - the masthead and the section headings
//   CAPS + muted  metadata  - field and vitals labels
//   ink           content   - everything a person actually reads
//
// The ONE place ruling still earns its keep is the ℞ table - four columns of
// different things (serial, name, dosage pattern, timing) can't be told apart
// by whitespace alone, and the pharmacy counter reads that block fastest when
// it looks like the table it has always been. Even there the rules are down to
// a hairline.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sheet's two label voices. Same letterform, different ink: teal marks
 * structure, muted marks metadata. Kept as constants so a heading and a field
 * label can never quietly drift apart - the whole minimal look rests on those
 * two being the only two.
 */
const CAPS_HEAD = "text-[12.5px] uppercase font-semibold";
const CAPS_LABEL = "text-[10.5px] uppercase font-semibold tracking-[0.09em]";

/**
 * The sheet's own masthead - a title on the left, the visit classification on
 * the right, closed by the one teal rule on the page.
 *
 * It exists because the pre-printed paper says who the HOSPITAL is but never
 * what the sheet IS, and a page that opens straight into "Name" reads like a
 * fragment. The rule under it also gives the patient block a top edge, which is
 * what stops the identity strip from floating in the middle of the letterhead.
 *
 * That rule is a hairline, not the 2px band it used to be: it is the only teal
 * rule on the sheet, so it reads as the masthead on weight alone and doesn't
 * need to shout to do it.
 */
export function SheetTitle({ title = "Out-patient case sheet", right }: {
  title?: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-[3px]" style={{ borderColor: "var(--pr-primary)" }}>
      <span className={CAPS_HEAD} style={{ color: "var(--pr-primary)" }}>
        {title}
      </span>
      {right}
    </div>
  );
}

/**
 * A section heading: the label in letterspaced teal caps, and a hairline
 * running out to the right margin.
 *
 * The hairline is a heading underline, not a writing line - it sits ABOVE the
 * space the doctor writes in, so it organises the page without inviting anyone
 * to write on it. It is also the sheet's only structural device now that the
 * tinted cells are gone, which is why it runs the full measure: at this weight
 * a short tick would read as a stray mark rather than a rule.
 */
export function SectionHead({ label, trailing }: { label: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <h3 className={`shrink-0 ${CAPS_HEAD}`} style={{ color: "var(--pr-primary)" }}>
        {label}
      </h3>
      <span className="h-px flex-1" style={{ background: "var(--pr-hair)", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} />
      {trailing}
    </div>
  );
}

/**
 * The consulting doctor, set where the pre-printed letterhead leaves a gap:
 * between the logo (left) and the JEEVA wordmark (right), which is exactly
 * where the hospital writes it by hand today.
 *
 * `inset` positions it absolutely into that gap for pre-printed stock; without
 * it the block sits in normal flow under a generated letterhead instead.
 */
export function DoctorHead({ doctor, inset = false }: {
  doctor?: { name: string; specialization: string; qualification?: string | null } | null;
  inset?: boolean;
}) {
  if (!doctor) return null;
  // The degree line the hospital hand-writes ("MBBS  M.D Pediatrics"). Falls
  // back to the specialization so the sheet never prints a nameless credential
  // gap for a doctor whose profile has no qualification typed in yet.
  const credentials = doctor.qualification?.trim() || doctor.specialization;
  // Name in ink, degrees in the metadata voice - the same pairing the patient
  // block uses, so the consultant reads as the sheet's first field rather than
  // as a second letterhead competing with the printed one above it.
  const body = (
    <div className="flex flex-col items-center  h-[100px] justify-end leading-tight">
      <div className="text-[24px] font-medium tracking-[-0.01em]" style={{ color: "var(--pr-ink)" }}>
        {doctor.name}
      </div>
      <div className={`mt-[3px] ${CAPS_LABEL}`} style={{ color: "var(--pr-muted)" }}>
        {credentials}
      </div>
    </div>
  );
  if (!inset) return <div className="mt-2">{body}</div>;
  return (
    /* 38-142mm: clear of the printed logo (ends ~37mm) and the wordmark
       (starts ~143mm), so a long name still lands in the gap. */
    <div className="absolute" style={{ top: "8mm", left: "38mm", width: "104mm" }}>
      {body}
    </div>
  );
}

/**
 * Next visit - the one line the patient leaves holding, and the only thing on
 * the sheet that belongs to the visit AFTER this one.
 *
 * It used to be a full-width heading closing the clinical body, which gave the
 * shortest value on the page the widest rule on it. Set on one line and pushed
 * right it takes about a third of that width and reads as a stamp on the
 * sheet's corner.
 *
 * Where that corner IS depends on the paper, and that is SheetFoot's problem,
 * not this component's - here it is simply an in-flow line that right-aligns.
 */
export function NextVisitNote({ value }: { value?: string | null }) {
  const body = (
    <div className="text-right flex items-center gap-2 justify-center leading-tight">
      <div className={CAPS_HEAD} style={{ color: "var(--pr-primary)" }}>Next visit: </div>
      {/* Non-breaking space so a blank pad keeps the line's height as writing
          space instead of collapsing to the label alone. */}
      <div className="mt-[3px] text-[12px] font-medium leading-[4.2mm]" style={{ color: "var(--pr-ink)" }}>
        {value?.trim() || " "}
      </div>
    </div>
  );
  return <div className="mt-[7px] flex justify-end">{body}</div>;
}

/**
 * The sheet's foot - the two things the patient walks out with: the tests to go
 * and get, and the date to come back on.
 *
 * `inset` lifts the pair off the end of the clinical body and into the bottom
 * band of the pre-printed paper, in the strip beside the printed QR:
 *
 *   left   13mm  the sheet's own margin, so Tests prescribed starts on the same
 *                line as Case history and every other heading above it
 *   right  27mm  from the paper's edge - the QR's left edge is at 24mm, so the
 *                strip stops 3mm clear of the code and never prints over it
 *   bottom 22mm  above the printed address band (which ends at 15mm) and inside
 *                the QR's own 19-46mm band, so the two read as one row
 *
 * On blank stock there is no QR and no reserved band, so the pair just closes
 * the clinical body in normal flow.
 */
export function SheetFoot({ tests, nextVisit, inset = false }: {
  tests?: string | null; nextVisit?: string | null; inset?: boolean;
}) {
  const body = (
    <>
      {/* Blank, this reserves less room inset than it does in the body: the band
          beside the QR is 27mm tall in total and the date has to fit under it. */}
      <OpenBlock label="Tests prescribed" inline value={tests} minHeight={inset ? "6mm" : "12mm"} />
      <NextVisitNote value={nextVisit} />
    </>
  );
  if (!inset) return body;
  return (
    <div className="absolute" style={{ left: "13mm", right: "27mm", bottom: "22mm" }}>
      {body}
    </div>
  );
}

/**
 * Screen-only ghost of the pre-printed paper.
 *
 * Nothing here prints. It exists so the person at the screen can see where
 * their sheet will land on the real stationery - otherwise the preview is a
 * page with a mysterious empty band at the top and no hospital name on it, and
 * the natural reaction is to "fix" that by switching back to the generated
 * letterhead and printing the logo twice.
 */
export function PreprintedGuide() {
  // Boxes measured off the stationery scan, in millimetres from the page edge -
  // drawn rather than photographed, because the only header asset in the repo
  // is the one-line version used for blank stock and its address sits at the
  // TOP, which is exactly the opposite of where the printed paper carries it.
  // Outlines, not fills: the guide sits on the same page as the sheet it is
  // guiding, and a block of tinted paper next to a sheet that now has no tint
  // anywhere read as part of the design rather than as a note about the tray.
  const zone = (label: string, s: React.CSSProperties) => (
    <div className="absolute flex items-center justify-center border border-dashed border-[#d3c8ab] text-center text-[7.5px] font-medium uppercase tracking-[0.14em] text-[#a38f60]"
      style={s}>
      {label}
    </div>
  );
  return (
    <div className="screen-only pointer-events-none select-none opacity-70 print:hidden" aria-hidden>
      {zone("Logo", { top: "5mm", left: "12mm", width: "25mm", height: "31mm" })}
      {zone("Jeeva Multi Speciality Hospital", { top: "8mm", left: "143mm", width: "54mm", height: "27mm" })}
      {zone("QR", { bottom: "19mm", right: "7mm", width: "17mm", height: "27mm" })}
      {zone("Printed address & phone band", { bottom: "2mm", left: "13mm", right: "13mm", height: "13mm" })}
      <div className="absolute inset-x-[13mm] border-t border-dashed border-[#b9a06a]" style={{ top: "40mm" }} />
      <div className="absolute inset-x-[13mm] border-t border-dashed border-[#b9a06a]" style={{ bottom: "46mm" }} />
    </div>
  );
}

/**
 * The patient block - three columns, as the hospital's own paper sets it:
 *
 *   Name          Age           Date
 *   Phone         UHID          OP No
 *   Address       Weight        Height
 *
 * Weight and Height sit on the address row rather than down in the vitals,
 * which is where the client's own printed sheet puts them: they are the two
 * numbers reception measures at the desk with the rest of the identity block,
 * not the four a nurse takes at triage.
 *
 * A field with no value prints its label and a run of blank paper, so the same
 * sheet serves a computer-filled visit and a hand-written one.
 */
export function FieldGrid({ fields }: {
  fields: { k: string; v?: string | null; span?: 1 | 2 | 3; mono?: boolean; wrap?: boolean }[];
}) {
  // Not equal thirds, and the tracks are set by what each column actually
  // holds. Column one takes Name, Phone and Address, so it needs the most;
  // column three takes the full visit stamp ("30 Jul 2026 · 11:20 AM") and
  // needs nearly as much; column two only ever holds an age or a UHID. On even
  // thirds this grid truncated the patient's surname - the one field on the
  // sheet that must never print with an ellipsis.
  return (
    <div className="grid grid-cols-[1.15fr_0.85fr_1fr] gap-x-5 gap-y-[5px]">
      {fields.map((f, i) => (
        <div key={i} className={`flex min-w-0 items-baseline gap-2 ${f.span === 3 ? "col-span-3" : f.span === 2 ? "col-span-2" : ""}`}>
          {/* No colon after the label: caps against ink already separate the two,
              and a column of colons was punctuation doing a job space does more
              quietly. */}
          <span className={`shrink-0 ${CAPS_LABEL}`} style={{ color: "var(--pr-primary)" }}>{f.k}: </span>
          {/* The line-height is the row height, and the non-breaking space below
              holds it with or without ink - so all three rows sit on a common
              baseline and a blank field is a writing space of a known size
              rather than a collapsed row.

              `wrap` is for the one field that no longer has the sheet's full
              width to itself: the address now shares its row with Weight and
              Height, and one line of a long address is a patient nobody can
              reach. Two lines, then the ellipsis.

              The clamp goes on the NESTED span below, not this one.
              `line-clamp-*` works by setting `display:-webkit-box`, and this
              span is a flex item - flex layout blockifies its display, which
              silently drops the clamp and lets the address run to a third and
              fourth line, pushing the whole split down the page. A child of a
              block box keeps the display it was given. */}
          <span className={`min-w-0 text-[13px] font-semibold leading-[4.2mm] ${f.wrap ? "" : "truncate"} ${f.mono ? "font-mono tracking-tight" : ""}`}
            style={{ color: "var(--pr-ink)" }}>
            {f.wrap
              ? <span className="line-clamp-2 break-words">{f.v?.trim() || " "}</span>
              : (f.v?.trim() || " ")}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Vitals as the pre-printed sheet lists them.
 *
 * They used to be the only boxed cells on the page - a tint plus a hairline, on
 * the argument that a nurse mid-round finds numbers faster in a box. What the
 * printed sheet showed is that they don't need one: these are the only MONO
 * figures on the sheet, and set in the same label-and-ink voice as the patient
 * block they read as one identity strip continuing - which is what they are -
 * while tinted cells read as a second table competing with it.
 *
 * `stack` is the column form - one vital per line - for the clinical rail down
 * the left of the split sheet, which is how the client's own paper sets them:
 * BP, Temp, Pulse, SpO₂ running down the margin beside the ℞. Unstacked they
 * lie three across on the patient block's own tracks.
 */
export function VitalsGrid({ items, stack = false }: {
  items: { label: string; value: string | null }[];
  stack?: boolean;
}) {
  // Unstacked: same tracks and gutter as FieldGrid above it, so the vitals land
  // on the patient block's own columns rather than on a second grid of their
  // own - which is the whole reason they no longer need a box.
  return (
    <div className={stack ? "flex flex-col gap-y-[8px]" : "grid grid-cols-[1.15fr_0.85fr_1fr]  gap-x-5 gap-y-[8px]"}>
      {items.map((b) => (
        <div key={b.label} className="flex min-w-0 items-baseline gap-2">
          <span className={`shrink-0 ${CAPS_LABEL}`} style={{ color: "var(--pr-primary)" }}>{b.label}: </span>
          <span className="font-mono text-[12px] font-semibold leading-[4.2mm]" style={{ color: "var(--pr-ink)" }}>
              {b.value || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A titled clinical section - case history, investigations, advice.
 *
 * `minHeight` is the writing space kept below the heading when nothing was
 * typed. It is reserved space, not a box: no border, no baseline, because the
 * doctor writes prose here and a ruled box would fight the handwriting.
 *
 * That reservation is dropped the moment there IS a value: the ink is then the
 * content, and holding the blank minimum under it as well was spending 12mm a
 * block on nothing - which is what pushed Next visit off the bottom of the
 * sheet onto a second page.
 *
 * `inline` prints a filled value beside the heading instead of under it, the
 * same treatment the Diagnosis line gets. Use it for the short one-liners
 * (tests prescribed, advice); prose that runs to several lines still reads
 * better in a block of its own.
 */
export function OpenBlock({ label, value, minHeight = "14mm", footnote, inline = false, grow = false }: {
  label: string; value?: string | null; minHeight?: string;
  /** Small print under the block - only rendered when there is a value. */
  footnote?: string;
  /** Set a filled value on the heading's own line. */
  inline?: boolean;
  /**
   * Take a share of the sheet's leftover height.
   *
   * The sheet is pinned to one page, so on a light visit there is slack, and it
   * has to land somewhere. Left to the ℞ pad alone it stretched those eight
   * ruled lines to 14mm each and the typed medicines floated in the middle of
   * them. Shared with the prose blocks it becomes what it should be: blank paper
   * under Case history and Investigation, where the pen goes.
   *
   * It costs nothing when the visit is heavy - there is no slack to take, and a
   * grown block never shrinks the text it already holds.
   */
  grow?: boolean;
}) {
  const text = value?.trim();

  if (text && inline) {
    return (
      <section className="mt-[7px]">
        <div className="flex items-baseline gap-2.5">
          <h3 className={`shrink-0 ${CAPS_HEAD}`} style={{ color: "var(--pr-primary)" }}>
            {label}: 
          </h3>
          <p className="min-w-0 flex-1 whitespace-pre-line text-[14.5px]  font-medium leading-snug"
            style={{ color: "var(--pr-ink)" }}>
            {text}
          </p>
        </div>
        {footnote && <p className="mt-[2px] text-[12px] italic" style={{ color: "var(--pr-muted)" }}>{footnote}</p>}
      </section>
    );
  }

  return (
    <section className={`mt-[7px] ${grow ? "flex flex-1 flex-col" : ""}`}>
      <SectionHead label={label} />
      <div className="mt-[3px] whitespace-pre-line text-[12px] font-medium leading-snug"
        style={{ minHeight: text ? undefined : minHeight, color: "var(--pr-ink)" }}>
        {text || ""}
      </div>
      {text && footnote && <p className="mt-[2px] text-[8px] italic" style={{ color: "var(--pr-muted)" }}>{footnote}</p>}
    </section>
  );
}

/**
 * The ℞ pad - the prescription table, ruled.
 *
 * This is the one block on the sheet that keeps its rules. Four columns of
 * different kinds of thing - the serial, the medicine, the ఉ-మ-రా dosage
 * pattern and the timing - cannot be told apart by whitespace alone, and the
 * pharmacy counter has read this exact table for years: the ℞ mark, a teal rule
 * closing the header, and the Telugu hints under the English column names,
 * which are what the patient actually reads back at home.
 *
 * What it no longer keeps is WEIGHT. The header used to sit between two 2px
 * teal bands, which made this block the loudest thing on a sheet whose masthead
 * is a hairline. One rule under the header does the same work, and the ℞ is set
 * light rather than black - it is a mark, not a headline.
 *
 * Always `slots` rows deep whether or not medicines were typed in, so the sheet
 * keeps one shape: reception's typed medicines print into the top rows and the
 * doctor keeps the numbered remainder to write on. Dosage is split on the fly -
 * "1-0-1 after food" becomes the pattern in its own column and "after food" in
 * timing - because that is the typing convention the /prescriptions form
 * already uses.
 */
export function RxPad({ items, slots = 9 }: {
  items: { medicineName: string; qty: number; dosage: string | null }[];
  slots?: number;
}) {
  const rows = Math.max(slots, items.length);
  return (
    /* THE PAD TAKES ITS COLUMN'S WHOLE HEIGHT.

       It used to compete with Case history and Investigation for the sheet's
       leftover height, stacked above and below it, and lost - on the hospital's
       pre-printed stock the logo band and the QR/address band are already in
       ink, so 86mm of the 297 is spoken for and 211mm holds the whole
       consultation. The pad came out at its bare eight rows.

       Side by side it doesn't have to compete: the prose blocks take the left
       rail and every millimetre of the right column from the patient block down
       to the foot is ruled writing space. */
    <section className="flex min-h-0 flex-1 flex-col">
      {/* Row `height` is a minimum and the table is now sized by its CONTENT,
          not stretched: slack turns into more lines below rather than eight
          over-tall ones here. A doctor writing a fourth medicine needs a fourth
          line, not a taller third one - and a typed medicine floating in the
          middle of a 14mm row read like a mistake. */}
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className={`text-left align-bottom ${CAPS_HEAD}`} style={{ color: "var(--pr-primary)" }}>
            {/* Column widths are set for the sheet's RIGHT-HAND two thirds, not
                its full measure: the pad shares the page with the clinical rail
                now, so the three fixed columns give up about 70px between them
                and the medicine name - the longest thing in the table - keeps
                the width it had. */}
            <th className="w-[30px] border-b pb-1 pr-1 text-[28px] font-normal leading-none" style={{ borderColor: "var(--pr-primary)" }}>℞</th>
            <th className="border-b pb-1.5 pr-2" style={{ borderColor: "var(--pr-primary)" }}>Medicine</th>
            <th className="w-[62px] border-b pb-1.5 pr-2" style={{ borderColor: "var(--pr-primary)" }}>
              Dosage<br /><span className="text-[8px] font-medium normal-case tracking-normal" style={{ color: "var(--pr-muted)" }}>ఉ – మ – రా</span>
            </th>
            <th className="w-[124px] border-b pb-1.5" style={{ borderColor: "var(--pr-primary)" }}>
              Timing &amp; duration<br /><span className="text-[8px] font-medium normal-case tracking-normal" style={{ color: "var(--pr-muted)" }}>భోజనం ముందు / తర్వాత</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => {
            const it = items[i];
            // "1-0-0 after food 1 month" -> pattern into its column, rest into timing
            const dosage = it?.dosage?.trim() ?? "";
            const m = dosage.match(/^([0-9]+(?:\/[0-9]+)?\s*[-–]\s*[0-9]+(?:\/[0-9]+)?\s*[-–]\s*[0-9]+(?:\/[0-9]+)?)\s*(.*)$/);
            const pattern = m ? m[1].replace(/\s/g, "") : "";
            const timing = m ? m[2] : dosage;
            return (
              /* 6.9mm: a comfortable handwriting line, and nine of them plus
                 the header is what fits between the pre-printed bands. */
              <tr key={i} className="border-b border-dotted pt-1 align-baseline" style={{ borderColor: "var(--pr-hair)", height: "8.5mm" }}>
                {/* No full stop after the serial - it is a tally, not a sentence. */}
                
                <td className="pr-2 pt-2 text-[14.5px] font-semibold" style={{ color: "var(--pr-ink)" }}>
                  {it ? <>{it.medicineName}{it.qty > 1 ? <span className="ml-1 font-normal text-[#57655f]">× {it.qty}</span> : null}</> : " "}
                </td>
                <td className="pr-2 font-mono text-[11.5px] font-semibold" style={{ color: "var(--pr-primary)" }}>{pattern}</td>
                <td className="text-[11.5px] font-medium" style={{ color: "#3c4a45" }}>{timing}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* CONTINUATION LINES - the leftover height, ruled at the same pitch.

          More rules than any sheet can show, clipped by the flex box that holds
          them: a light visit reveals eight or ten, a heavy one reveals none,
          and neither case needs the height measured first. They carry no serial
          because they are not slots the desk typed into - they are the rest of
          the page, ruled, which is what a prescription pad has always been. */}
      <div className="relative min-h-0 flex-1 overflow-hidden" aria-hidden="true">
        {/* Absolutely positioned, and that is the whole trick: in flow these
            rules are content, so the sheet grew to fit all sixteen of them
            instead of the box shrinking to the space left - a 397mm "A4" page.
            Out of flow they measure nothing, so this div contributes no height
            of its own, takes exactly the leftover, and clips the rest. */}
        <div className="absolute inset-x-0 top-0">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="border-b border-dotted" style={{ height: "8.5mm", borderColor: "var(--pr-hair)" }} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Solid footer band - appointments · address · timings. Pinned to sheet bottom. */
export function FooterBand({ hospital }: { hospital: HospitalInfo | null }) {
  return (
    <div className="mt-auto">
      <div style={{ background: "var(--pr-accent)", height: 3 }} />
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-0.5 px-4 py-2 text-[10px] font-medium text-white"
        style={{ background: "var(--pr-primary)", margin: "0 -11mm" }}>
        <span>For Appointments: <span className="font-bold">{hospital?.phone ?? "-"}</span></span>
        <span>{hospital ? `${hospital.addressLine}, ${hospital.city} – ${hospital.pincode}` : ""}</span>
        <span>OPD 8:00 AM – 8:00 PM · Emergency 24×7</span>
      </div>
    </div>
  );
}