/**
 * Reading the doctor's handwritten OPD sheet.
 *
 * Pure parsing, deliberately outside the React component - same split as
 * lib/pharmacy/invoice-parse.ts, and for the same reason: this is the part that
 * can be wrong in ways nobody notices. A misread digit here is not a typo. It
 * is a BP of 1300, a dosage of 1-0-1 read off a line that said 1-0-0, or a
 * medicine name that resolves to the wrong drug in the pharmacy catalog.
 *
 * So NOTHING here is trusted. Every value is a SUGGESTION that lands in a form
 * field for the receptionist to read against the paper still in their hand.
 * Two rules follow from that, and both matter more than extracting more:
 *
 *   1. A value outside human range is DROPPED, not filled. A blank field says
 *      "read this off the sheet yourself". A field holding 1300/80 says the
 *      computer knows something, and it is the one a tired desk will not
 *      re-check at 7pm.
 *   2. A medicine name is never resolved to a catalog id from OCR text. It
 *      lands as free text, which is exactly what the pharmacist's amber dot
 *      already means: "match this by hand". A misread brand silently matched to
 *      a real product is how the wrong drug gets dispensed.
 *
 * THE LAYOUT. The doctor writes on the hospital's own pre-printed stationery
 * (components/print/stationery.tsx), so the PRINTED labels are the anchors and
 * the handwriting is what sits beside them:
 *
 *   BP (mmHg) · Pulse (bpm) · SpO₂ (%) · Temp (°F) · Height (cm) · Weight (kg)
 *   Case history
 *   Diagnosis
 *   ℞  | Medicine | Dosage (ఉ-మ-రా) | Timing & duration
 *   Investigation
 *   Tests prescribed
 *   Advice
 *   Next visit
 *
 * Those printed words OCR reliably even when the handwriting beside them does
 * not - which is what makes the sheet parseable at all.
 */

export interface ParsedVitals {
  bpSystolic: string; bpDiastolic: string; pulse: string;
  heightCm: string; weightKg: string; tempF: string; spo2: string;
}

export interface ParsedMed {
  medicineName: string;
  qty: string;
  /** "1-0-1", plus any timing written after it: "1-0-1 after food 5 days". */
  dosage: string;
}

export interface ParsedPrescription {
  vitals: ParsedVitals;
  medicines: ParsedMed[];
  labs: string[];
  nextVisit: string;
  diagnosis: string;
  advice: string;
  caseHistory: string;
}

export const NO_VITALS: ParsedVitals = {
  bpSystolic: "", bpDiastolic: "", pulse: "", heightCm: "", weightKg: "", tempF: "", spo2: "",
};

/** True when the scan yielded nothing worth putting in front of anyone. */
export function isEmptyParse(p: ParsedPrescription): boolean {
  return (
    p.medicines.length === 0 &&
    p.labs.length === 0 &&
    !p.nextVisit && !p.diagnosis && !p.advice && !p.caseHistory &&
    Object.values(p.vitals).every((v) => v === "")
  );
}

/** Human-readable tally, for telling the desk what was actually filled in. */
export function describeParse(p: ParsedPrescription): string {
  const bits: string[] = [];
  if (p.medicines.length) bits.push(`${p.medicines.length} medicine${p.medicines.length === 1 ? "" : "s"}`);
  const vitalCount = Object.values(p.vitals).filter((v) => v !== "").length;
  if (vitalCount) bits.push(`${vitalCount} vital${vitalCount === 1 ? "" : "s"}`);
  if (p.labs.length) bits.push(`${p.labs.length} test${p.labs.length === 1 ? "" : "s"}`);
  if (p.nextVisit) bits.push("next visit");
  if (p.diagnosis) bits.push("diagnosis");
  if (p.caseHistory) bits.push("case history");
  if (p.advice) bits.push("advice");
  return bits.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OCR emits table borders as `|`, subscripts as their own glyphs, and three
 * different dashes. Flatten all of it before anything tries to match, so the
 * patterns below stay readable instead of each carrying its own noise clause.
 */
function normalize(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .replace(/[|¦]/g, " ")
    .replace(/[₂]/g, "2")
    .replace(/[₀]/g, "0")
    .replace(/[–—―]/g, "-")
    .replace(/[’‘`´]/g, "'")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vitals
//
// Read off the whole sheet rather than a section: the vitals strip sits above
// Case history with no heading of its own, and on a hand-filled sheet the
// numbers wrap unpredictably. The printed unit in brackets is the anchor.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plausible human ranges. Deliberately WIDE - this is not a clinical judgement,
 * it is a filter for OCR nonsense. A real hypertensive crisis (220/130) must
 * pass; a misread 1300 must not.
 */
const RANGE: Record<keyof ParsedVitals, [number, number]> = {
  bpSystolic: [50, 300],
  bpDiastolic: [20, 200],
  pulse: [20, 250],
  spo2: [40, 100],
  tempF: [86, 113],
  heightCm: [30, 250],
  weightKg: [1, 300],
};

function inRange(key: keyof ParsedVitals, raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  const [lo, hi] = RANGE[key];
  return n >= lo && n <= hi ? raw : "";
}

/**
 * `label (unit): value`, where every part of the punctuation is optional
 * because OCR drops colons and turns "(°F)" into "CF)" often enough that
 * requiring them loses more than it protects.
 */
function labelled(text: string, label: string, digits: string): string {
  const re = new RegExp(
    `\\b(?:${label})\\b\\s*(?:\\([^)]{0,10}\\))?\\s*[:.\\-=]?\\s*(${digits})`,
    "i"
  );
  return text.match(re)?.[1] ?? "";
}

export function parseVitals(text: string): ParsedVitals {
  const flat = normalize(text).join("\n");
  const int = "\\d{1,3}";
  const dec = "\\d{1,3}(?:\\.\\d{1,2})?";

  // BP is the one pair - "130/80". A slash misread as a 1 or a 7 is common, so
  // accept the usual confusions as the separator.
  const bp = flat.match(/\bB\.?\s?P\.?\b\s*(?:\([^)]{0,10}\))?\s*[:.\-=]?\s*(\d{2,3})\s*[/\\|lI]\s*(\d{2,3})/i);

  const out: ParsedVitals = {
    bpSystolic: bp ? inRange("bpSystolic", bp[1]) : "",
    bpDiastolic: bp ? inRange("bpDiastolic", bp[2]) : "",
    // PR is what a lot of hands write instead of Pulse.
    pulse: inRange("pulse", labelled(flat, "pulse|P\\.?R", int)),
    // "SpO2", "Sp02", "SPO2", "Sa02" - the O/0 confusion runs both ways.
    spo2: inRange("spo2", labelled(flat, "sp[o0]2|sa[o0]2|sp[o0]", int)),
    tempF: inRange("tempF", labelled(flat, "temp\\w*|T\\.?E\\.?M\\.?P", dec)),
    heightCm: inRange("heightCm", labelled(flat, "height|ht", dec)),
    weightKg: inRange("weightKg", labelled(flat, "weight|wt", dec)),
  };

  // Systolic below diastolic means the pair was read backwards or one of them
  // was misread. Neither number can be trusted alone, so drop both.
  if (out.bpSystolic && out.bpDiastolic && Number(out.bpSystolic) <= Number(out.bpDiastolic)) {
    out.bpSystolic = ""; out.bpDiastolic = "";
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
//
// The sheet's printed headings, in the order stationery.tsx lays them out.
// Everything after a heading belongs to it until the next one starts.
// ─────────────────────────────────────────────────────────────────────────────

type SectionKey = "caseHistory" | "diagnosis" | "rx" | "investigation" | "tests" | "advice" | "nextVisit";

const HEADINGS: { key: SectionKey; re: RegExp }[] = [
  { key: "caseHistory", re: /^case\s*hist\w*\b/i },
  { key: "diagnosis", re: /^(?:diagnos[ie]s|dx|provisional\s+diagnos[ie]s)\b/i },
  // The ℞ glyph is ONE character and OCRs as R, B, R/ or nothing at all. The
  // table's column header is the dependable way in, so match that whole row -
  // "℞ | Medicine | Dosage | Timing & duration" - and consume it, or the
  // column names themselves become the first line of the section above.
  { key: "rx", re: /^.{0,4}\bmedicines?\b.*\b(?:dosage|timing|duration)\b.*$/i },
  { key: "rx", re: /^(?:℞|r\s*x|r\/|medicines?\b|tablets?\b)/i },
  { key: "investigation", re: /^investigat\w*\b/i },
  { key: "tests", re: /^tests?\s*(?:prescribed|advised|adv)?\b|^investigations?\s*advised\b|^labs?\s*advised\b/i },
  { key: "advice", re: /^advice\b|^advise[ds]?\b/i },
  { key: "nextVisit", re: /^next\s*visit\b|^review\s*(?:on|after)?\b|^follow[\s-]*up\b/i },
];

/** Heading -> the lines under it. The first line keeps whatever followed a colon. */
function sections(lines: string[]): Map<SectionKey, string[]> {
  const out = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;

  for (const line of lines) {
    const hit = HEADINGS.find((h) => h.re.test(line));
    if (hit) {
      current = hit.key;
      if (!out.has(current)) out.set(current, []);
      // "Diagnosis: Viral fever" - the value is on the heading line itself.
      const rest = line.replace(hit.re, "").replace(/^\s*[:.\-=]\s*/, "").trim();
      if (rest) out.get(current)!.push(rest);
      continue;
    }
    if (current) out.get(current)!.push(line);
  }
  return out;
}

const textOf = (m: Map<SectionKey, string[]>, k: SectionKey, max: number): string => {
  const v = (m.get(k) ?? []).join(" ").replace(/\s+/g, " ").trim();
  // A trailing heading fragment or a lone rule character is not content.
  return v.length > 1 ? v.slice(0, max) : "";
};

// ─────────────────────────────────────────────────────────────────────────────
// Medicines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The dosage pattern this hospital writes - "1-0-1", "1/2-0-1", "0-0-1".
 * It is the single most reliable thing on a handwritten ℞ line: three small
 * numbers separated by dashes appear nowhere else on the sheet, so it anchors
 * where the name ends and the timing begins.
 */
const DOSE = /(\d(?:\s*\/\s*\d)?)\s*-\s*(\d(?:\s*\/\s*\d)?)\s*-\s*(\d(?:\s*\/\s*\d)?)/;

/** Serial number the sheet prints down the ℞ column: "1.", "2)", "3 -". */
const SERIAL = /^\s*\d{1,2}\s*[.)\-]\s*/;

/**
 * "× 10", "x 10", "x10", "650x10", "Qty 10" - the count, however it was written.
 *
 * The space before the × cannot be required. Tesseract closes gaps it doesn't
 * see clearly, and on a real read "TAB DOLO 650 x 10" comes back as
 * "TABDOLO 650x10" - so a rule that needed whitespace found no quantity at all
 * and left "650x10" sitting in the drug name.
 *
 * The LAST match wins, because the count is written at the end of the line
 * while a strength ("500/125") sits inside the name. A residual risk stays: a
 * brand genuinely containing x-then-digits loses that suffix to the qty box.
 * It is visible in an editable field with the paper in hand, which is the
 * trade this whole screen is built on.
 */
function takeQty(s: string): { text: string; qty: string } {
  const re = /[x×X]\s*(\d{1,3})(?![\d.])|qty\.?\s*[:.\-]?\s*(\d{1,3})(?![\d.])/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(s); m; m = re.exec(s)) last = m;
  if (!last) return { text: s, qty: "" };

  const without = (s.slice(0, last.index) + " " + s.slice(last.index + last[0].length)).replace(/\s+/g, " ").trim();
  // Stripping it must not consume the drug's name along with the count.
  if ((without.match(/[A-Za-z]/g) ?? []).length < 2) return { text: s, qty: "" };
  return { text: without, qty: last[1] ?? last[2] ?? "" };
}

/**
 * "TABDOLO" -> "TAB DOLO".
 *
 * The same closed gap, in the one place it is safely reversible: the dose-form
 * prefixes every Indian prescription starts with. Restricted to that list - a
 * general re-speller would invent word breaks inside real brand names.
 */
const LATIN_FREQ: Record<string, string> = {
  OD: "1-0-0 (Once daily)",
  BD: "1-0-1 (Twice daily)",
  BID: "1-0-1 (Twice daily)",
  TDS: "1-1-1 (Thrice daily)",
  TID: "1-1-1 (Thrice daily)",
  QID: "1-1-1-1 (Four times daily)",
  HS: "0-0-1 (At bedtime)",
  QHS: "0-0-1 (At bedtime)",
  SOS: "As needed (SOS)",
  STAT: "Single dose (STAT)",
};

const LATIN_RE = /\b(BD|BID|TDS|TID|OD|QID|HS|QHS|SOS|STAT)\b/i;

function splitDoseForm(s: string): string {
  let res = s.replace(/^(TAB|CAP|SYP|SYRUP|INJ|OINT|CREAM|DROPS?|SUSP|SACHET|GEL)\.?([A-Za-z])/i, "$1 $2");
  // Expand common handwritten shorthands
  res = res.replace(/\bPCM\b/i, "PARACETAMOL");
  res = res.replace(/\bAMOX\b/i, "AMOXICILLIN");
  res = res.replace(/\bPANTO\b/i, "PANTOPRAZOLE");
  res = res.replace(/\bAZITH\b/i, "AZITHROMYCIN");
  return res;
}

/** Strip the noise OCR glues onto a handwritten drug name. */
function cleanName(s: string): string {
  return s
    .replace(SERIAL, "")
    .replace(/[^A-Za-z0-9 .\-/%+()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^A-Za-z]+$/, "");
}

/**
 * One ℞ line into a medicine.
 */
function parseRxLine(raw: string): ParsedMed | null {
  const line = raw.replace(/\s+/g, " ").trim();
  if (line.length < 3) return null;
  if (/^(?:medicine|dosage|timing|duration|s\.?no)\b/i.test(line)) return null;

  const dose = line.match(DOSE);
  const latin = !dose ? line.match(LATIN_RE) : null;

  let namePart = line;
  let dosage = "";

  if (dose && dose.index !== undefined) {
    namePart = line.slice(0, dose.index);
    const pattern = `${dose[1]}-${dose[2]}-${dose[3]}`.replace(/\s+/g, "");
    const timing = line
      .slice(dose.index + dose[0].length)
      .replace(/[^A-Za-z0-9 .\-/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    dosage = timing ? `${pattern} ${timing}`.slice(0, 120) : pattern;
  } else if (latin && latin.index !== undefined) {
    namePart = line.slice(0, latin.index);
    const code = latin[1].toUpperCase();
    const pattern = LATIN_FREQ[code] || code;
    const timing = line
      .slice(latin.index + latin[0].length)
      .replace(/[^A-Za-z0-9 .\-/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    dosage = timing ? `${pattern} ${timing}`.slice(0, 120) : pattern;
  }

  const { text, qty } = takeQty(namePart);
  const medicineName = splitDoseForm(cleanName(text));
  if ((medicineName.match(/[A-Za-z]/g) ?? []).length < 2) return null;

  return { medicineName: medicineName.slice(0, 120), qty, dosage };
}

/**
 * The ℞ block.
 *
 * Lines are taken from the ℞ section when the sheet's heading was legible. When
 * it was not - which happens, the glyph is a single character - fall back to
 * ANY line carrying a dosage pattern. That fallback is why the pattern has to
 * be as distinctive as it is.
 */
function parseMedicines(lines: string[], secs: Map<SectionKey, string[]>): ParsedMed[] {
  const block = secs.get("rx");
  const source = block && block.length ? block : lines.filter((l) => DOSE.test(l));

  const out: ParsedMed[] = [];
  const seen = new Set<string>();
  for (const line of source) {
    const med = parseRxLine(line);
    if (!med) continue;
    const key = med.medicineName.toLowerCase();
    // OCR duplicates a line when the pen crosses a rule. Same name, same
    // dosage, twice in a row is a scanning artefact, not two prescriptions.
    const dedupe = `${key}|${med.dosage}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(med);
    if (out.length >= 30) break;   // the send endpoint's own ceiling
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advised tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "CBP, CUE and Dengue NS1" -> three chips.
 *
 * Split on commas, semicolons, slashes and the serial numbers a doctor uses
 * when listing them down the margin. Names stay as written: they are matched
 * against the lab master server-side, and an unmatched one still prints and
 * still lands on the outstanding list.
 */
function parseLabs(secs: Map<SectionKey, string[]>): string[] {
  const raw = [...(secs.get("tests") ?? []), ...(secs.get("investigation") ?? [])];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of raw) {
    for (const piece of line.split(/[,;/]|\s+\d{1,2}\s*[.)]\s*|\band\b/i)) {
      const name = piece
        .replace(SERIAL, "")
        .replace(/[^A-Za-z0-9 .\-+()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if ((name.match(/[A-Za-z]/g) ?? []).length < 2) continue;
      if (name.length > 120) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= 20) return out;   // the send endpoint's own ceiling
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole sheet.
 *
 * Every field is independent: a sheet where only the vitals came out legible
 * fills the vitals and leaves the rest for the pen. Partial is the normal
 * result here, not a failure mode.
 */
export function parsePrescriptionText(text: string): ParsedPrescription {
  const lines = normalize(text);
  const secs = sections(lines);

  return {
    vitals: parseVitals(text),
    medicines: parseMedicines(lines, secs),
    labs: parseLabs(secs),
    // Lengths mirror the server validator (validators/reception.ts), so nothing
    // extracted can be rejected on arrival for being too long.
    nextVisit: textOf(secs, "nextVisit", 80),
    diagnosis: textOf(secs, "diagnosis", 300),
    advice: textOf(secs, "advice", 600),
    caseHistory: textOf(secs, "caseHistory", 1200),
  };
}

/**
 * AI-enhanced prescription parsing using Gemini Vision API.
 * Calls /api/v1/ai/vision-ocr with image base64, falling back to text parsing.
 */
export async function parsePrescriptionWithAi(
  imageBase64: string,
  fallbackText?: string
): Promise<ParsedPrescription> {
  try {
    const res = await fetch("/api/v1/ai/vision-ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mode: "prescription" }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.prescriptionItems) && data.prescriptionItems.length > 0) {
        const medicines: ParsedMed[] = data.prescriptionItems.map((item: any) => ({
          medicineName: String(item.name || "").toUpperCase().trim(),
          dosage: `${item.frequency || "OD"} ${item.duration ? `· ${item.duration}` : ""}`.trim(),
          qty: "1",
        }));


        const baseParse = fallbackText ? parsePrescriptionText(fallbackText) : {
          vitals: NO_VITALS,
          medicines: [],
          labs: [],
          nextVisit: "",
          diagnosis: "",
          advice: "",
          caseHistory: "",
        };

        return {
          ...baseParse,
          medicines: medicines.length > 0 ? medicines : baseParse.medicines,
        };
      }
    }
  } catch (err) {
    console.warn("AI Vision OCR call failed, using text fallback:", err);
  }

  return parsePrescriptionText(fallbackText || "");
}

