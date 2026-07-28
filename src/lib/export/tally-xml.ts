/**
 * Tally-importable vouchers.
 *
 * WHY XML AND NOT A SPREADSHEET
 * -----------------------------
 * The day-close .xlsx next door is a report: a human reads it and retypes the
 * totals. This is different. Tally's own import format is XML, and a file in it
 * lands in the CA's books as actual double-entry vouchers - no retyping, and no
 * transcription errors between the hospital's takings and its accounts.
 *
 * DOUBLE ENTRY, HONESTLY
 * ----------------------
 * Tally will accept unbalanced vouchers and then quietly carry the difference,
 * which is the worst outcome: the import "works" and the trial balance is wrong.
 * So every voucher built here balances to zero by construction, and
 * `buildTallyXml` refuses to emit one that doesn't.
 *
 * Sign convention is Tally's, and it is the opposite of what most people
 * expect: AMOUNT is NEGATIVE for a debit and POSITIVE for a credit.
 *
 *   Sales      Dr Party/Cash (-total)   Cr Income (+taxable)  Cr CGST/SGST (+tax)
 *   Receipt    Dr Cash/Bank  (-amount)  Cr Party    (+amount)
 *   CreditNote Dr Income     (-amount)  Cr Party/Cash (+amount)
 *
 * LEDGERS ARE MATCHED BY NAME
 * ---------------------------
 * Tally has no ids in an import - it matches on the ledger's exact name. A name
 * that doesn't exist in the company file either fails the import or silently
 * creates a duplicate ledger, so the names come from HospitalConfig where the
 * hospital's CA can set them to whatever they actually called things.
 */

export type TallyVoucherType = "Sales" | "Receipt" | "Credit Note";

export interface TallyEntry {
  ledger: string;
  /** Tally's convention: negative debits, positive credits. */
  amount: number;
  /** Party name on the ledger line, for debtor/creditor entries. */
  isDeemedPositive?: boolean;
}

export interface TallyVoucher {
  type: TallyVoucherType;
  /** Voucher date, YYYYMMDD - Tally's format, not ISO. */
  date: string;
  /** Our receipt number. Becomes the voucher number in Tally. */
  voucherNo: string;
  /** Shown against the voucher; the patient or buyer name. */
  partyName: string;
  narration?: string;
  entries: TallyEntry[];
}

export interface TallyExportInput {
  companyName: string;
  from: string;
  to: string;
  vouchers: TallyVoucher[];
}

/** XML text escaping. Patient names carry & and ' more often than you'd think. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ISO date (YYYY-MM-DD) to Tally's YYYYMMDD. */
export const toTallyDate = (iso: string): string => iso.replace(/-/g, "");

/** Two decimals, and never "-0.00", which Tally reads as a malformed number. */
const amt = (n: number): string => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toFixed(2);
};

/**
 * Does this voucher balance?
 *
 * Tolerance is half a paisa, to absorb the float error that accumulates when a
 * tax line is derived by percentage. Anything larger is a real defect and the
 * export refuses rather than shipping books that don't add up.
 */
export function isBalanced(v: TallyVoucher): boolean {
  const sum = v.entries.reduce((s, e) => s + e.amount, 0);
  return Math.abs(sum) < 0.005;
}

export class TallyImbalanceError extends Error {
  constructor(public voucherNo: string, public difference: number) {
    super(
      `Voucher ${voucherNo} does not balance (out by ${difference.toFixed(2)}). ` +
        `Refusing to export - an unbalanced voucher would silently corrupt the trial balance.`
    );
    this.name = "TallyImbalanceError";
  }
}

function voucherXml(v: TallyVoucher): string {
  const entries = v.entries
    .map(
      (e) => `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(e.ledger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${e.amount < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
            <AMOUNT>${amt(e.amount)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`
    )
    .join("");

  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${escapeXml(v.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${v.date}</DATE>
          <EFFECTIVEDATE>${v.date}</EFFECTIVEDATE>
          <VOUCHERTYPENAME>${escapeXml(v.type)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(v.voucherNo)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(v.partyName)}</PARTYLEDGERNAME>
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${
            v.narration ? `\n          <NARRATION>${escapeXml(v.narration)}</NARRATION>` : ""
          }${entries}
        </VOUCHER>
      </TALLYMESSAGE>`;
}

/**
 * The importable document.
 *
 * Throws on the first unbalanced voucher. That is the right severity: a partial
 * export is far more dangerous than none, because the CA has no way to tell
 * which vouchers were dropped and the books look plausible either way.
 */
export function buildTallyXml(input: TallyExportInput): string {
  for (const v of input.vouchers) {
    if (!isBalanced(v)) {
      throw new TallyImbalanceError(v.voucherNo, v.entries.reduce((s, e) => s + e.amount, 0));
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(input.companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${input.vouchers.map(voucherXml).join("")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

/** What lands in the accountant's Downloads folder. */
export const tallyFilename = (from: string, to: string): string =>
  from === to ? `jeeva-tally-${from}.xml` : `jeeva-tally-${from}_to_${to}.xml`;
