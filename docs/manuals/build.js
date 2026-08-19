/**
 * BUILDS THE STAFF MANUALS - one .docx per portal.
 *
 * Run:  node docs/manuals/build.js            (all portals)
 *       node docs/manuals/build.js reception  (just one)
 *
 * The content lives in ./content/<portal>.js as plain data - blocks of headings,
 * paragraphs, steps, tables, callouts and diagrams. Keeping it as data rather
 * than as Word markup means a correction is a one-line edit by anybody, and the
 * six manuals cannot drift into six different layouts.
 *
 * `docx` is resolved from the project if it is installed there, otherwise from
 * wherever npm put it - install with `npm i -D docx` to regenerate.
 */

const fs = require("fs");
const path = require("path");

let docx;
try {
  docx = require("docx");
} catch {
  try {
    docx = require(path.join(process.env.DOCX_HOME || "", "node_modules", "docx"));
  } catch {
    console.error("The `docx` package is missing. Install it with:  npm i -D docx");
    process.exit(1);
  }
}

const sharp = require("sharp");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, ImageRun, PageBreak, Footer, Header, PageNumber,
  TableOfContents, LevelFormat, convertInchesToTwip,
} = docx;

const OUT_DIR = __dirname;
const DIAGRAM_DIR = path.join(__dirname, "diagrams");

// ── PALETTE ── the portal's own colours, toned for paper and photocopiers.
const C = {
  ink: "12211F",
  body: "2B3A37",
  muted: "5A6A66",
  teal: "0F766E",
  tealSoft: "E6F2F0",
  blue: "1D4ED8",
  blueSoft: "E8EEFC",
  amber: "8A6414",
  amberSoft: "FDF3DC",
  rose: "B42318",
  roseSoft: "FDECEA",
  line: "B9C6C2",
  headBg: "0F766E",
};

const PAGE_WIDTH_DXA = 9740; // A4 (11906 twips) minus the 0.75" margins set below

/**
 * INLINE MARKUP, deliberately tiny: **bold**, `code`, and nothing else.
 * A manual written by four people needs one way to emphasise a thing.
 */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: "Consolas", color: C.teal, ...base }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

const para = (text, opts = {}) =>
  new Paragraph({
    children: runs(text, { size: opts.size ?? 21, color: opts.color ?? C.body, font: "Calibri" }),
    spacing: { after: opts.after ?? 140, line: 288 },
    alignment: opts.align,
    indent: opts.indent,
  });

function heading(text, level) {
  const map = {
    1: { size: 34, color: C.teal, before: 320, after: 160, h: HeadingLevel.HEADING_1 },
    2: { size: 27, color: C.ink, before: 280, after: 120, h: HeadingLevel.HEADING_2 },
    3: { size: 23, color: C.teal, before: 220, after: 90, h: HeadingLevel.HEADING_3 },
  }[level];
  return new Paragraph({
    heading: map.h,
    spacing: { before: map.before, after: map.after },
    children: [new TextRun({ text, bold: true, size: map.size, color: map.color, font: "Calibri" })],
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: C.line };
const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function tableBlock({ head, rows, widths }) {
  const cols = head ? head.length : rows[0].length;
  const w = widths && widths.length === cols
    ? widths.map((p) => Math.round((PAGE_WIDTH_DXA * p) / 100))
    : Array.from({ length: cols }, () => Math.round(PAGE_WIDTH_DXA / cols));
  // rounding must not leave the columns short of the table width
  w[w.length - 1] += PAGE_WIDTH_DXA - w.reduce((s, x) => s + x, 0);

  const mkCell = (text, i, isHead) =>
    new TableCell({
      width: { size: w[i], type: WidthType.DXA },
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      borders: allBorders,
      shading: isHead
        ? { type: ShadingType.CLEAR, fill: C.headBg, color: "auto" }
        : { type: ShadingType.CLEAR, fill: "FFFFFF", color: "auto" },
      children: [
        new Paragraph({
          spacing: { after: 0, line: 264 },
          children: runs(String(text), {
            size: 19,
            bold: isHead || undefined,
            color: isHead ? "FFFFFF" : C.body,
            font: "Calibri",
          }),
        }),
      ],
    });

  const trs = [];
  if (head) trs.push(new TableRow({ tableHeader: true, children: head.map((h, i) => mkCell(h, i, true)) }));
  rows.forEach((r) => trs.push(new TableRow({ children: r.map((c, i) => mkCell(c, i, false)) })));

  return new Table({
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: w,
    rows: trs,
  });
}

/** A tinted callout - note / warning / rule. Single-cell table with a fat left edge. */
function callout({ tone = "note", title, lines }) {
  const map = {
    note: { fill: C.tealSoft, edge: C.teal, label: title || "Gurthu pettukondi" },
    warn: { fill: C.amberSoft, edge: C.amber, label: title || "Jagratha" },
    stop: { fill: C.roseSoft, edge: C.rose, label: title || "System oppukodu" },
    tip: { fill: C.blueSoft, edge: C.blue, label: title || "Tip" },
  }[tone];

  const kids = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: map.label, bold: true, size: 20, color: map.edge, font: "Calibri" })],
    }),
    ...lines.map(
      (l, i) =>
        new Paragraph({
          spacing: { after: i === lines.length - 1 ? 0 : 80, line: 276 },
          children: runs(l, { size: 20, color: C.body, font: "Calibri" }),
        })
    ),
  ];

  return new Table({
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: [PAGE_WIDTH_DXA],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            shading: { type: ShadingType.CLEAR, fill: map.fill, color: "auto" },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: map.fill },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: map.fill },
              right: { style: BorderStyle.SINGLE, size: 2, color: map.fill },
              left: { style: BorderStyle.SINGLE, size: 18, color: map.edge },
            },
            children: kids,
          }),
        ],
      }),
    ],
  });
}

function spacer(h = 120) {
  return new Paragraph({ spacing: { after: h }, children: [new TextRun({ text: "" })] });
}

/** Render one diagram to PNG (2x for crispness) and return an ImageRun paragraph. */
async function diagramParagraph(name, svgString, maxWidthPx = 620) {
  fs.mkdirSync(DIAGRAM_DIR, { recursive: true });
  const file = path.join(DIAGRAM_DIR, `${name}.png`);
  const meta = svgString.match(/width="(\d+)" height="(\d+)"/);
  const w = Number(meta[1]);
  const h = Number(meta[2]);
  await sharp(Buffer.from(svgString), { density: 144 })
    .resize({ width: w * 2 })
    .png()
    .toFile(file);
  const scale = Math.min(1, maxWidthPx / w);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 140, after: 200 },
    children: [
      new ImageRun({
        type: "png",
        data: fs.readFileSync(file),
        transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
      }),
    ],
  });
}

async function blocksToChildren(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.t) {
      case "h1": out.push(heading(b.x, 1)); break;
      case "h2": out.push(heading(b.x, 2)); break;
      case "h3": out.push(heading(b.x, 3)); break;
      case "p": out.push(para(b.x)); break;
      case "lead":
        out.push(para(b.x, { size: 23, color: C.muted, after: 200 }));
        break;
      case "ul":
        b.items.forEach((i) =>
          out.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 70, line: 288 },
              children: runs(i, { size: 21, color: C.body, font: "Calibri" }),
            })
          )
        );
        out.push(spacer(60));
        break;
      case "steps":
        b.items.forEach((i) =>
          out.push(
            new Paragraph({
              numbering: { reference: "steps", level: 0 },
              spacing: { after: 80, line: 288 },
              children: runs(i, { size: 21, color: C.body, font: "Calibri" }),
            })
          )
        );
        out.push(spacer(60));
        break;
      case "table":
        out.push(tableBlock(b));
        out.push(spacer(160));
        break;
      case "note": out.push(callout({ tone: "note", title: b.title, lines: b.lines })); out.push(spacer(160)); break;
      case "warn": out.push(callout({ tone: "warn", title: b.title, lines: b.lines })); out.push(spacer(160)); break;
      case "stop": out.push(callout({ tone: "stop", title: b.title, lines: b.lines })); out.push(spacer(160)); break;
      case "tip": out.push(callout({ tone: "tip", title: b.title, lines: b.lines })); out.push(spacer(160)); break;
      case "img": out.push(await diagramParagraph(b.name, b.svg, b.max)); break;
      case "caption":
        out.push(para(b.x, { size: 18, color: C.muted, align: AlignmentType.CENTER, after: 220 }));
        break;
      case "pb": out.push(new Paragraph({ children: [new PageBreak()] })); break;
      default: throw new Error("unknown block: " + b.t);
    }
  }
  return out;
}

function coverBlocks(manual) {
  return [
    new Paragraph({ spacing: { before: 1400, after: 0 }, children: [new TextRun({ text: "JEEVA HOSPITAL MANAGEMENT SYSTEM", bold: true, size: 22, color: C.muted, font: "Calibri", characterSpacing: 40 })] }),
    new Paragraph({
      spacing: { before: 260, after: 60 },
      children: [new TextRun({ text: manual.title, bold: true, size: 56, color: C.teal, font: "Calibri" })],
    }),
    new Paragraph({
      spacing: { after: 320 },
      children: [new TextRun({ text: "Staff User Manual", size: 32, color: C.ink, font: "Calibri" })],
    }),
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 12, color: C.teal } },
      spacing: { after: 260 },
      children: [new TextRun({ text: "" })],
    }),
    ...manual.cover.map((l) => para(l, { size: 22 })),
    new Paragraph({
      spacing: { before: 900 },
      children: [
        new TextRun({ text: manual.edition, size: 19, color: C.muted, font: "Calibri" }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function tocBlocks() {
  return [
    heading("Ee manual lo em undi", 1),
    para("Prati heading meeda Ctrl kotti click cheste aa page ki velthundi. Print cheste page numbers kinda unnayi."),
    new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

async function buildManual(manual) {
  const body = [
    ...coverBlocks(manual),
    ...tocBlocks(),
    ...(await blocksToChildren(manual.blocks)),
  ];

  const doc = new Document({
    // Word fills the table of contents on open instead of showing an empty
    // field somebody has to know to press F9 on.
    features: { updateFields: true },
    creator: "Jeeva HMS",
    title: `${manual.title} - Staff User Manual`,
    description: manual.cover[0],
    numbering: {
      config: [
        {
          reference: "steps",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
            },
          ],
        },
      ],
    },
    styles: {
      default: { document: { run: { font: "Calibri", size: 21, color: C.body } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 120 },
                children: [new TextRun({ text: `Jeeva · ${manual.title}`, size: 17, color: C.muted, font: "Calibri" })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 17, color: C.muted, font: "Calibri" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 17, color: C.muted, font: "Calibri" }),
                  new TextRun({ text: " / ", size: 17, color: C.muted, font: "Calibri" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: C.muted, font: "Calibri" }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  const file = path.join(OUT_DIR, manual.file);
  fs.writeFileSync(file, buf);
  return { file, bytes: buf.length };
}

async function main() {
  const only = process.argv[2];
  const names = ["reception", "doctor", "pharmacy", "labs", "insurance", "admin"];
  const list = only ? names.filter((n) => n === only) : names;
  if (!list.length) {
    console.error("Unknown portal. One of: " + names.join(", "));
    process.exit(1);
  }
  for (const n of list) {
    const manual = require(path.join(__dirname, "content", n + ".js"));
    const { file, bytes } = await buildManual(manual);
    console.log(`${path.basename(file)}  ${(bytes / 1024).toFixed(0)} KB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
