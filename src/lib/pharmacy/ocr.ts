/**
 * Running recognition over a prepared invoice.
 *
 * ── WHY IT USED TO STOP AT 70% ──
 *
 * Two separate things, which together looked like one hang.
 *
 * The PROGRESS BAR only ever listened for the status "recognizing text", and
 * ignored the four stages before it - fetching the WASM core, fetching a 12MB
 * language model, unpacking it, initialising the API. So the number sat at 0
 * through the slow part, jumped, then sat again: tesseract reports recognition
 * progress per block of layout, and the last block on a dense invoice is the
 * big one. A bar that stops at 70 and stays there reads as a crash, so people
 * reloaded the page - throwing away work that was seconds from finishing.
 *
 * The SPEED was the real problem underneath. A 12-megapixel phone photo is four
 * times more pixels than recognition needs, and the cost is superlinear. The
 * enhancement pass in `image-prep` is most of the fix; what is left here is
 * telling the truth about progress while it runs.
 *
 * ── AND WHY IT RETURNED NOTHING BUT THE DATE ──
 *
 * Page segmentation. The default mode expects prose, and tries to find columns
 * and paragraphs in a table - so it reads a GST invoice DOWN the columns, and
 * emits "MPB260688 DLA26026 SC26022..." as one line. The header regexes still
 * matched, because they scan the whole page for "Date:" and a supplier name, so
 * the supplier and the invoice date filled in perfectly while the line items
 * came back empty. That is the exact reported symptom, and it is a
 * configuration bug, not a bad photograph.
 *
 * SINGLE_BLOCK keeps the rows intact. When even that yields nothing, the pass
 * is repeated with two other segmentations before giving up - a retry costs
 * seconds, and the alternative is a pharmacist typing 23 lines by hand.
 */

import { PSM, createWorker, type Worker } from "tesseract.js";
import { parseInvoiceText, type ParsedRow } from "./invoice-parse";
import { enhanceForOcr, canvasToBlob } from "./image-prep";

export interface OcrProgress {
  /** 0-100, monotonic across every stage. Never sticks. */
  pct: number;
  /** What is happening, in words a pharmacist can act on. */
  stage: string;
}

export interface OcrResult {
  text: string;
  rows: ParsedRow[];
  /** The enhanced images actually fed to recognition, for the before/after view. */
  prepared: HTMLCanvasElement[];
  /** Degrees of tilt corrected on the first page. */
  skewDeg: number;
  /** How many passes it took. More than one means the scan was hard to read. */
  passes: number;
}

/**
 * Segmentations, in the order worth trying.
 *
 * SINGLE_BLOCK first: it treats the page as one uniform block of text and keeps
 * table rows as rows. AUTO is the general-purpose fallback for an invoice with a
 * genuinely multi-column layout. SPARSE_TEXT is the last resort for a photo so
 * poor that no layout can be found at all - it finds text anywhere, in any
 * order, which is bad for columns but better than an empty grid.
 */
const MODES: { psm: PSM; label: string }[] = [
  { psm: PSM.SINGLE_BLOCK, label: "table rows" },
  { psm: PSM.AUTO, label: "automatic layout" },
  { psm: PSM.SPARSE_TEXT, label: "scattered text" },
];

let cached: Promise<Worker> | null = null;

/**
 * The recognition worker, kept between runs.
 *
 * The language model is 12MB. tesseract.js caches it in IndexedDB so it is
 * fetched once per browser, but re-creating the worker still costs a second or
 * two of unpacking - and this screen is used on one invoice after another.
 */
function getWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  cached ??= createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      // The stages BEFORE recognition, which used to report nothing at all.
      const pre: Record<string, [number, number, string]> = {
        "loading tesseract core": [2, 8, "Starting the reader"],
        "initializing tesseract": [8, 12, "Starting the reader"],
        "loading language traineddata": [12, 20, "Loading the language model"],
        "initializing api": [20, 24, "Getting ready"],
      };
      const band = pre[m.status];
      if (band) onProgress?.({ pct: Math.round(band[0] + (band[1] - band[0]) * (m.progress || 0)), stage: band[2] });
    },
  }).catch((e) => { cached = null; throw e; });
  return cached;
}

/** Drop the cached worker - called when a run fails, so the next one starts clean. */
export async function resetOcr(): Promise<void> {
  const w = cached;
  cached = null;
  try { await (await w)?.terminate(); } catch { /* already gone */ }
}

/**
 * Enhance, recognise, parse - the whole path from a photo to grid rows.
 *
 * `sources` is a list because a PDF is a list: every page of a multi-page
 * invoice is recognised and its rows concatenated, exactly as the paper reads.
 */
export async function recognizeInvoice(
  sources: (Blob | HTMLCanvasElement)[],
  opts: { onProgress?: (p: OcrProgress) => void; enhance?: boolean } = {},
): Promise<OcrResult> {
  const { onProgress, enhance = true } = opts;
  if (!sources.length) throw new Error("Nothing to read.");

  // ---- 1. enhance (0-15%) ----
  const prepared: HTMLCanvasElement[] = [];
  let skewDeg = 0;
  for (let i = 0; i < sources.length; i++) {
    onProgress?.({
      pct: Math.round(2 + (13 * i) / sources.length),
      stage: sources.length > 1 ? `Sharpening page ${i + 1} of ${sources.length}` : "Sharpening the scan",
    });
    if (!enhance && sources[i] instanceof HTMLCanvasElement) {
      prepared.push(sources[i] as HTMLCanvasElement);
      continue;
    }
    const r = await enhanceForOcr(sources[i]);
    if (i === 0) skewDeg = r.skewDeg;
    prepared.push(r.canvas);
  }

  // ---- 2. recognise (24-95%), escalating page segmentation ----
  const worker = await getWorker(onProgress);
  let best: { text: string; rows: ParsedRow[] } = { text: "", rows: [] };
  let passes = 0;

  for (const mode of MODES) {
    passes++;
    await worker.setParameters({
      tessedit_pageseg_mode: mode.psm,
      // Without this tesseract collapses runs of spaces, and the gap between an
      // empty FREE column and the next one is exactly such a run - collapse it
      // and every column right of it shifts one place left.
      preserve_interword_spaces: "1",
      // Told, not guessed. The estimate from a cropped photo is often wildly
      // wrong, and it drives the layout analysis that finds the rows.
      user_defined_dpi: "300",
    });

    const chunks: string[] = [];
    for (let i = 0; i < prepared.length; i++) {
      const span = 70 / (prepared.length * MODES.length);
      const base = 24 + span * (i + prepared.length * (passes - 1));
      onProgress?.({
        pct: Math.round(base),
        stage: passes > 1
          ? `Retrying - reading as ${mode.label}`
          : prepared.length > 1 ? `Reading page ${i + 1} of ${prepared.length}` : "Reading the invoice",
      });
      const blob = await canvasToBlob(prepared[i]);
      const { data } = await worker.recognize(blob);
      chunks.push(data.text);
      onProgress?.({ pct: Math.round(base + span * 0.9), stage: "Reading the invoice" });
    }

    const text = chunks.join("\n");
    const rows = parseInvoiceText(text);
    if (rows.length > best.rows.length) best = { text, rows };
    // Enough rows to be a real read of a real invoice. Stop; another pass would
    // only cost the pharmacist twenty seconds to arrive at the same answer.
    if (best.rows.length >= 3) break;
  }

  onProgress?.({ pct: 100, stage: "Done" });
  return { text: best.text, rows: best.rows, prepared, skewDeg, passes };
}
