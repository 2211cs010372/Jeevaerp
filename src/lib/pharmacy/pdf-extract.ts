/**
 * Reading an invoice that arrived as a PDF.
 *
 * Distributors send two completely different things under the same extension,
 * and telling them apart is the whole job:
 *
 *   A TEXT PDF is what their billing software exported. Every character is in
 *   the file already, with its exact position on the page. There is nothing to
 *   recognise - running OCR over a render of it would take thirty seconds to
 *   arrive at a WORSE answer than reading it directly, because OCR can misread
 *   a digit and a text layer cannot.
 *
 *   A SCANNED PDF is a photograph in a wrapper. It has no text at all, and the
 *   only way in is to rasterise the page and put it through the same enhance-
 *   and-recognise path as a phone snap.
 *
 * So: try the text layer first, always. Fall back to rasterising only when the
 * page really is a picture. Most supplier PDFs take the first path and come out
 * perfect and instant.
 *
 * ── PUTTING THE TEXT BACK INTO LINES ──
 *
 * A text layer is not lines, it is a bag of positioned fragments - "DULCOFLEX"
 * at (91, 604), "15T" at (233, 604), "10" at (296, 604). The parser downstream
 * reads a row as a sequence of space-separated tokens, so the fragments have to
 * be grouped back into rows by their y coordinate and sorted by x. The gap
 * between two fragments decides whether they are one word or two: a price split
 * across the fragments "148" and ".70" must NOT gain a space, or it parses as
 * two numbers and the whole row shifts a column.
 */

import type { ParsedRow } from "./invoice-parse";

/** A PDF, read. */
export interface PdfExtract {
  /** Page text, joined - the same shape `parseInvoiceText` takes from OCR. */
  text: string;
  pageCount: number;
  /** True when the text came from the file itself rather than from recognition. */
  hasTextLayer: boolean;
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * pdf.js, loaded once and configured for the browser.
 *
 * The worker is what keeps a 40-page PDF from freezing the till: parsing runs
 * off the main thread. `new URL(..., import.meta.url)` is how the bundler is
 * told to emit that worker as an asset rather than trying to inline it.
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    // pdf.js 4 expects Promise.withResolvers, which is newer than some of the
    // machines a hospital front desk actually runs.
    const P = Promise as unknown as { withResolvers?: unknown };
    if (typeof P.withResolvers !== "function") {
      P.withResolvers = function withResolvers<T>() {
        let resolve!: (v: T | PromiseLike<T>) => void;
        let reject!: (r?: unknown) => void;
        const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      };
    }
    const pdfjs = await import("pdfjs-dist");
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    } catch {
      // A bundler that didn't rewrite the URL. pdf.js falls back to running on
      // the main thread, which is slow but still correct.
    }
    return pdfjs;
  })();
  return pdfjsPromise;
}

/** One positioned fragment off the text layer. */
interface Frag { x: number; y: number; w: number; h: number; s: string }

/**
 * Fragments back into lines.
 *
 * Rows are found by y, with a tolerance of half a line height - PDF text
 * fragments on the same visual row are rarely on exactly the same baseline once
 * a superscript or a different font size is involved.
 */
function fragsToLines(frags: Frag[]): string[] {
  if (!frags.length) return [];

  const heights = frags.map((f) => f.h).filter((h) => h > 0).sort((a, b) => a - b);
  const lineH = heights[Math.floor(heights.length / 2)] || 10;
  const tol = Math.max(2, lineH * 0.5);

  // Top of the page first. `y` arrives in DEVICE space, where it grows
  // downward - so ascending y is reading order. Sorting it the other way puts
  // the last line item first, and a grid running backwards against the paper is
  // exactly how a row gets checked off against the wrong line.
  const rows: Frag[][] = [];
  for (const f of [...frags].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - f.y) <= tol) row.push(f);
    else rows.push([f]);
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let out = "";
    let prevEnd = -Infinity;
    for (const f of row) {
      if (!f.s) continue;
      // A gap wider than a quarter of a line height is a real space. Anything
      // tighter is kerning inside one number: "148" + ".70" is 148.70, and
      // splitting it there would hand the parser two columns where there is one.
      const gap = f.x - prevEnd;
      if (out && gap > lineH * 0.25) out += " ";
      out += f.s;
      prevEnd = f.x + f.w;
    }
    return out.replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

/**
 * The text of a PDF, from its own text layer.
 *
 * Returns `hasTextLayer: false` when the file is a scan - the caller then
 * rasterises instead. The threshold is deliberately generous: a scanned invoice
 * often carries a stray watermark or a page number in real text, and a handful
 * of characters is not an invoice.
 */
export async function readPdfText(file: Blob): Promise<PdfExtract> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const frags: Frag[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;                 // a marked-content tag
        const s = item.str;
        if (!s || !s.trim()) continue;
        // Into device space, so a page saved rotated still reads left-to-right.
        // The viewport transform already flips PDF's y-up into screen y-down;
        // flipping it a second time is what reversed the rows.
        const m = pdfjs.Util.transform(viewport.transform, item.transform);
        frags.push({ x: m[4], y: m[5], w: item.width ?? 0, h: item.height || Math.abs(m[3]) || 10, s });
      }
      pages.push(fragsToLines(frags).join("\n"));
      page.cleanup();
    }

    const text = pages.join("\n");
    const letters = (text.match(/[A-Za-z0-9]/g) ?? []).length;
    return { text, pageCount: doc.numPages, hasTextLayer: letters >= 200 };
  } finally {
    await doc.destroy();
  }
}

/**
 * Every page of a PDF, rasterised for recognition.
 *
 * Rendered at whatever scale puts the page at `targetWidth` pixels across -
 * a PDF page has no inherent resolution, so asking for "300 DPI" is meaningless
 * and asking for a pixel width is not.
 */
export async function renderPdfPages(
  file: Blob,
  opts: { targetWidth?: number; maxPages?: number; onPage?: (page: number, total: number) => void } = {},
): Promise<HTMLCanvasElement[]> {
  const { targetWidth = 2200, maxPages = 10, onPage } = opts;
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  try {
    const total = Math.min(doc.numPages, maxPages);
    const out: HTMLCanvasElement[] = [];
    for (let p = 1; p <= total; p++) {
      onPage?.(p, total);
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, targetWidth / base.width) });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas is unavailable in this browser.");
      // Paper first: a PDF page is transparent where nothing is drawn, and a
      // transparent background binarises to solid black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent "print", not the default "display".
      //
      // Display rendering drives itself off requestAnimationFrame, and a
      // browser stops firing those in a tab that isn't visible. Switch away
      // from the pharmacy while a ten-page scan rasterises and the whole
      // extraction silently stops until you switch back - which is precisely
      // the "it just sits there forever" this screen is meant to be rid of.
      // Print intent runs on promises instead, and is the truer intent anyway:
      // the page as it would be put on paper is the page we want to read.
      await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
      page.cleanup();
      out.push(canvas);
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Convenience for the caller: does this file claim to be a PDF? */
export const isPdf = (f: File | Blob & { name?: string }) =>
  f.type === "application/pdf" || /\.pdf$/i.test((f as File).name ?? "");

export type { ParsedRow };
