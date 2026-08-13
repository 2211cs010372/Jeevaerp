/**
 * Making a photograph of an invoice readable.
 *
 * Tesseract was built for scanner output: black ink, white paper, square to the
 * page, around 300 DPI. What it actually gets here is a phone held over a
 * counter - a 12-megapixel JPEG, a shadow across one half of the page, the
 * paper a few degrees off square, and the whole thing either far too big or,
 * from a screenshot, far too small.
 *
 * Feeding that in raw is the single biggest reason extraction "loads to 70% and
 * then gives up": the 12MP frame is four times more pixels than recognition
 * needs, so it takes minutes rather than seconds, and the shadow defeats the
 * global threshold tesseract applies internally, so half the page comes back as
 * mush anyway. Slow AND wrong, from the same cause.
 *
 * Four steps, in this order, because each one depends on the last:
 *
 *   1. SCALE to tesseract's sweet spot. Big photos get smaller (faster), small
 *      screenshots get bigger (a 9px-tall digit is not recognisable at all).
 *   2. GREY, by luminance. Blue table rules and a red company stamp both go to
 *      mid-grey, which is what we want - they are not text.
 *   3. DESKEW. A two-degree tilt is invisible to a person and fatal to a table:
 *      the right-hand end of one row drifts into the row below, and every line
 *      comes out with columns from two different products glued together.
 *   4. BINARISE, locally. The one step that has to be local: a global cut-off
 *      chosen for the lit half of the page turns the shadowed half solid black.
 *
 * All of it runs in the browser on canvas. Nothing is uploaded - a supplier
 * invoice carries the hospital's GSTIN and its trade prices.
 */

/** What the pipeline did, so the screen can tell the pharmacist. */
export interface PrepResult {
  canvas: HTMLCanvasElement;
  /** Rotation applied, in degrees. Positive is clockwise. */
  skewDeg: number;
  /** Longest-side scale factor relative to the source. */
  scale: number;
  width: number;
  height: number;
}

export interface PrepOptions {
  /**
   * Longest side of the working image. ~2200px is A4 at 300 DPI on the short
   * edge - enough that a 2mm-tall digit lands on 20-odd pixels, and small
   * enough that recognition finishes in seconds rather than minutes.
   */
  maxSide?: number;
  /** Never upscale past this - blowing a thumbnail up only magnifies JPEG mush. */
  maxUpscale?: number;
  deskew?: boolean;
  binarize?: boolean;
}

const DEFAULTS: Required<PrepOptions> = {
  maxSide: 2200,
  maxUpscale: 3,
  deskew: true,
  binarize: true,
};

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  // willReadFrequently: every stage below round-trips through getImageData, and
  // without the hint Chrome keeps the canvas on the GPU and stalls on each read.
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  return ctx;
}

/** Anything droppable, decoded. */
async function decode(src: Blob | ImageBitmap | HTMLCanvasElement): Promise<ImageBitmap | HTMLCanvasElement> {
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) return src;
  if (src instanceof HTMLCanvasElement) return src;
  return createImageBitmap(src as Blob);
}

/** Luminance grey, in place. Rec. 601 - it is what tesseract's own grey uses. */
function toGrey(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}

/**
 * Percentile contrast stretch.
 *
 * Invoices are printed on a dot-matrix or a cheap thermal head, and a photo of
 * one occupies maybe a third of the available range - paper at 150 rather than
 * 255, ink at 90 rather than 0. Stretching that back out before thresholding is
 * what makes faint carbon-copy text survive at all.
 *
 * Clipped at the 1st and 99th percentile so a single black staple hole or a
 * blown-out highlight can't define the whole range.
 */
function stretch(d: Uint8ClampedArray): void {
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  const total = d.length / 4;
  const lowCut = total * 0.01, highCut = total * 0.99;

  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lowCut) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total - highCut) { hi = v; break; } }
  if (hi - lo < 16) return;                       // flat image - leave it alone

  const span = hi - lo;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, ((v - lo) / span) * 255));
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
}

/**
 * Sauvola adaptive threshold.
 *
 * Every pixel gets its own cut-off, computed from the mean and the standard
 * deviation of a window around it, so a shadow gradient across the page shifts
 * the threshold with it instead of swallowing the text. Otsu and every other
 * global method pick ONE number for the whole page, which on a hand-held photo
 * means one half legible and the other half a black rectangle.
 *
 * Computed off integral images, so the window size costs nothing: four array
 * lookups per pixel regardless of how wide the window is.
 *
 *   T = m * (1 + k * (s / R - 1))     k = 0.2, R = 128
 *
 * k is the standard value and it is a deliberate bias toward keeping ink:
 * losing a stroke off a batch number is unrecoverable, whereas the speckle a
 * low k leaves behind is dropped by the parser as an unreadable token.
 */
function sauvola(d: Uint8ClampedArray, w: number, h: number): void {
  const n = w * h;
  // Float64 because the sum of squares over a 2200x3000 page overflows anything
  // narrower: 6.6e6 pixels x 255^2 is well past a 32-bit integer.
  const sum = new Float64Array((w + 1) * (h + 1));
  const sqSum = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0, rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = d[(y * w + x) * 4];
      rowSum += v;
      rowSq += v * v;
      const i = (y + 1) * (w + 1) + (x + 1);
      sum[i] = sum[i - (w + 1)] + rowSum;
      sqSum[i] = sqSum[i - (w + 1)] + rowSq;
    }
  }

  // A window has to be wider than a character and narrower than a column gap.
  const win = Math.max(15, Math.round(Math.min(w, h) / 30) | 1);
  const r = win >> 1;
  const k = 0.2, R = 128;
  const out = new Uint8ClampedArray(n);

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const a = y0 * (w + 1) + x0, b = y0 * (w + 1) + (x1 + 1);
      const c = (y1 + 1) * (w + 1) + x0, e = (y1 + 1) * (w + 1) + (x1 + 1);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = (sum[e] - sum[b] - sum[c] + sum[a]) / area;
      const variance = Math.max(0, (sqSum[e] - sqSum[b] - sqSum[c] + sqSum[a]) / area - mean * mean);
      const t = mean * (1 + k * (Math.sqrt(variance) / R - 1));
      out[y * w + x] = d[(y * w + x) * 4] > t ? 255 : 0;
    }
  }
  for (let i = 0; i < n; i++) {
    const v = out[i];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
}

/**
 * How far off square the page is, in degrees.
 *
 * A table of text has a strong horizontal rhythm: rows of ink separated by
 * bands of paper. Rotate the page until that rhythm is sharpest and you have
 * found the skew. "Sharpest" is measured as the variance of the row-ink profile
 * - at the true angle each row's ink lands in one bucket and the variance
 * peaks; a degree off and it smears across two.
 *
 * Run on a small thumbnail, because the answer is an angle and an angle does not
 * need six million pixels to find.
 */
function findSkew(ink: Uint8Array, w: number, h: number): number {
  const profile = new Float64Array(h);
  let best = 0, bestScore = -1;

  for (let deg = -6; deg <= 6; deg += 0.25) {
    const slope = Math.tan((deg * Math.PI) / 180);
    profile.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ink[y * w + x]) continue;
        // Shear rather than rotate: over +/-6 degrees the difference is far
        // below one pixel, and a shear is a single add per row.
        //
        // MINUS, so a positive result means a page tilted clockwise - which is
        // then the angle to rotate BACK by. Getting this sign backwards doubles
        // the tilt instead of removing it, and the search runs to its own limit
        // looking for a peak that is receding from it.
        const yy = y - Math.round((x - w / 2) * slope);
        if (yy < 0 || yy >= h) continue;
        profile[yy]++;
      }
    }
    let mean = 0;
    for (let y = 0; y < h; y++) mean += profile[y];
    mean /= h;
    let score = 0;
    for (let y = 0; y < h; y++) { const dv = profile[y] - mean; score += dv * dv; }
    if (score > bestScore) { bestScore = score; best = deg; }
  }
  // Below half a degree the correction costs more in resampling blur than the
  // tilt costs in accuracy.
  return Math.abs(best) < 0.5 ? 0 : best;
}

/**
 * A small BINARY copy, for measuring the skew on.
 *
 * Binary, not grey, and that is the whole point. The measure is the variance of
 * the ink-per-row profile, and on a greyscale photo with a shadow across it the
 * shadow contributes far more "ink" than the text does - so the profile
 * describes the lighting, the variance peaks wherever the gradient is steepest,
 * and the search runs off to its own limit. Thresholding first, locally, throws
 * the lighting away and leaves only strokes.
 */
function thumbInk(canvas: HTMLCanvasElement, target = 700): { ink: Uint8Array; w: number; h: number } {
  const s = Math.min(1, target / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * s));
  const h = Math.max(1, Math.round(canvas.height * s));
  const t = makeCanvas(w, h);
  const tc = ctxOf(t);
  tc.drawImage(canvas, 0, 0, w, h);
  const frame = tc.getImageData(0, 0, w, h);
  toGrey(frame.data);
  sauvola(frame.data, w, h);
  const ink = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < frame.data.length; i += 4, j++) ink[j] = frame.data[i] ? 0 : 1;
  return { ink, w, h };
}

/** Rotate a canvas about its centre, on white. */
function rotate(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const w = src.width * cos + src.height * sin;
  const h = src.width * sin + src.height * cos;
  const out = makeCanvas(w, h);
  const ctx = ctxOf(out);
  // White, not transparent: the corners the rotation exposes must read as paper.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(-rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/**
 * The whole pipeline. Hand it a photo, get back something tesseract can read.
 */
export async function enhanceForOcr(
  src: Blob | ImageBitmap | HTMLCanvasElement,
  opts: PrepOptions = {},
): Promise<PrepResult> {
  const o = { ...DEFAULTS, ...opts };
  const img = await decode(src);
  const sw = img.width, sh = img.height;

  // 1. SCALE. Down when the photo is oversized, up when a screenshot is too
  //    small for the glyphs to survive - both ends of that range are common.
  const scale = Math.min(o.maxSide / Math.max(sw, sh), o.maxUpscale);
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  let canvas = makeCanvas(w, h);
  let ctx = ctxOf(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);

  // 2 + 3. GREY, stretch, then find and undo the tilt. The skew has to be
  //        measured on greyscale and corrected BEFORE binarising, because
  //        rotating a black-and-white image resamples it into grey again.
  let frame = ctx.getImageData(0, 0, w, h);
  toGrey(frame.data);
  stretch(frame.data);
  ctx.putImageData(frame, 0, 0);

  let skewDeg = 0;
  if (o.deskew) {
    const t = thumbInk(canvas);
    skewDeg = findSkew(t.ink, t.w, t.h);
    if (skewDeg !== 0) {
      canvas = rotate(canvas, skewDeg);
      ctx = ctxOf(canvas);
    }
  }

  // 4. BINARISE, per-pixel, against a local background.
  if (o.binarize) {
    frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    sauvola(frame.data, canvas.width, canvas.height);
    ctx.putImageData(frame, 0, 0);
  }

  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();

  return { canvas, skewDeg, scale, width: canvas.width, height: canvas.height };
}

/** A canvas as a PNG blob - lossless, because JPEG artefacts are what we removed. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't read the prepared image."))),
      "image/png",
    );
  });
}
