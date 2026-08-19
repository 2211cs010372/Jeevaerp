/**
 * DIAGRAM HELPERS - boxes, arrows, lanes.
 *
 * The manuals are read by people who will not read paragraphs: a receptionist
 * checks one step, a pharmacist checks what happens after "Receive". A flow
 * drawn on the page answers that faster than any amount of prose, and it is the
 * one thing a printed manual can do that the screen cannot - show the WHOLE
 * journey at once, including the parts that belong to somebody else's counter.
 *
 * Written as SVG and rasterised with sharp at 2x, because Word embeds a picture
 * reliably everywhere while an SVG needs a fallback and a modern Word to render.
 * Keep every colour print-safe: these are photocopied and pinned up.
 */

const INK = "#12211f";
const MUTED = "#5a6a66";
const TEAL = "#0f766e";
const TEAL_SOFT = "#e6f2f0";
const BLUE = "#1d4ed8";
const BLUE_SOFT = "#e8eefc";
const AMBER = "#8a6414";
const AMBER_SOFT = "#fdf3dc";
const ROSE = "#b42318";
const ROSE_SOFT = "#fdecea";
const LINE = "#b9c6c2";

const FONT = "Segoe UI, Calibri, Arial, sans-serif";

const TONES = {
  teal: { fill: TEAL_SOFT, stroke: TEAL, text: TEAL },
  blue: { fill: BLUE_SOFT, stroke: BLUE, text: BLUE },
  amber: { fill: AMBER_SOFT, stroke: AMBER, text: AMBER },
  rose: { fill: ROSE_SOFT, stroke: ROSE, text: ROSE },
  plain: { fill: "#ffffff", stroke: LINE, text: INK },
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Break a label onto as many lines as it needs for the box width. */
function wrap(text, maxChars) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function textBlock(lines, x, y, { size = 13, weight = 600, fill = INK, anchor = "middle", lh = 16 } = {}) {
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + i * lh}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(l)}</text>`
    )
    .join("");
}

/** A rounded box with a title and an optional smaller second line. */
function box({ x, y, w, h, title, sub, tone = "plain" }) {
  const t = TONES[tone] ?? TONES.plain;
  const titleLines = wrap(title, Math.floor(w / 7.2));
  const subLines = sub ? wrap(sub, Math.floor(w / 6.0)) : [];
  const blockH = titleLines.length * 16 + (subLines.length ? subLines.length * 13 + 4 : 0);
  const top = y + (h - blockH) / 2 + 12;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.4"/>` +
    textBlock(titleLines, x + w / 2, top, { size: 13, weight: 600, fill: t.text }) +
    (subLines.length
      ? textBlock(subLines, x + w / 2, top + titleLines.length * 16 + 2, {
          size: 11,
          weight: 400,
          fill: MUTED,
          lh: 13,
        })
      : "")
  );
}

/** A decision diamond. */
function diamond({ cx, cy, w, h, title, tone = "amber" }) {
  const t = TONES[tone] ?? TONES.amber;
  const pts = `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`;
  const lines = wrap(title, Math.floor(w / 8.5));
  return (
    `<polygon points="${pts}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.4"/>` +
    textBlock(lines, cx, cy - (lines.length - 1) * 7 + 4, { size: 12, weight: 600, fill: t.text, lh: 14 })
  );
}

const ARROW_DEF = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${MUTED}"/></marker></defs>`;

function arrow(x1, y1, x2, y2, label, dashed) {
  const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ah)"${dashed ? ' stroke-dasharray="5 4"' : ""}/>`;
  if (!label) return line;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const horizontal = Math.abs(y2 - y1) < 6;
  return (
    line +
    `<text x="${horizontal ? mx : mx + 8}" y="${horizontal ? my - 7 : my}" font-family="${FONT}" font-size="11" font-weight="600" fill="${MUTED}" text-anchor="${horizontal ? "middle" : "start"}">${esc(label)}</text>`
  );
}

/** An elbow arrow: across, then down (or the reverse), for return paths. */
function elbow(x1, y1, x2, y2, label) {
  const midX = x2;
  const path = `<path d="M ${x1} ${y1} H ${midX} V ${y2}" fill="none" stroke="${MUTED}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#ah)"/>`;
  return (
    path +
    (label
      ? `<text x="${(x1 + midX) / 2}" y="${y1 - 7}" font-family="${FONT}" font-size="11" font-weight="600" fill="${MUTED}" text-anchor="middle">${esc(label)}</text>`
      : "")
  );
}

function caption(text, x, y, { size = 12, weight = 700, fill = INK, anchor = "start" } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
}

function svg(width, height, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    ARROW_DEF +
    body +
    "</svg>"
  );
}

/**
 * A LEFT-TO-RIGHT CHAIN of steps, wrapping onto rows.
 * The bread-and-butter picture: "this, then this, then this."
 */
function chain(steps, { width = 980, boxW = 168, boxH = 74, gap = 42, perRow = 4, title } = {}) {
  const rows = [];
  for (let i = 0; i < steps.length; i += perRow) rows.push(steps.slice(i, i + perRow));
  const topPad = title ? 40 : 16;
  const rowH = boxH + 54;
  const height = topPad + rows.length * rowH;
  let body = title ? caption(title, 4, 22, { size: 14 }) : "";

  rows.forEach((row, r) => {
    const y = topPad + r * rowH;
    const rowWidth = row.length * boxW + (row.length - 1) * gap;
    const startX = Math.max(4, (width - rowWidth) / 2);
    row.forEach((s, i) => {
      const x = startX + i * (boxW + gap);
      body += box({ x, y, w: boxW, h: boxH, title: s.label, sub: s.sub, tone: s.tone ?? "teal" });
      if (i < row.length - 1) body += arrow(x + boxW + 6, y + boxH / 2, x + boxW + gap - 6, y + boxH / 2, s.arrow);
    });
    // wrap arrow down to the next row
    if (r < rows.length - 1) {
      const lastX = startX + (row.length - 1) * (boxW + gap) + boxW / 2;
      const nextY = y + rowH;
      body += `<path d="M ${lastX} ${y + boxH + 4} V ${y + boxH + 24} H ${startX + boxW / 2} V ${nextY - 6}" fill="none" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ah)"/>`;
    }
  });

  return svg(width, height, body);
}

/**
 * SWIMLANES - who does what, and where the work crosses a counter.
 * `lanes` = [{ name, steps: [{ label, sub, tone, col }] }], `cols` = column count.
 */
function lanes(lanesIn, { width = 980, cols = 5, boxH = 66, laneGap = 18, title } = {}) {
  const labelW = 132;
  const colW = (width - labelW - 16) / cols;
  const boxW = colW - 22;
  const topPad = title ? 42 : 14;
  const laneH = boxH + laneGap;
  const height = topPad + lanesIn.length * laneH + 10;
  let body = title ? caption(title, 4, 24, { size: 14 }) : "";

  lanesIn.forEach((lane, li) => {
    const y = topPad + li * laneH;
    body +=
      `<rect x="0" y="${y - 6}" width="${width}" height="${boxH + 12}" fill="${li % 2 ? "#f7faf9" : "#ffffff"}" stroke="${LINE}" stroke-width="0.8"/>` +
      `<text x="10" y="${y + boxH / 2 + 4}" font-family="${FONT}" font-size="12" font-weight="700" fill="${INK}">${esc(lane.name)}</text>`;
    lane.steps.forEach((s) => {
      const x = labelW + s.col * colW + 11;
      body += box({ x, y, w: boxW, h: boxH, title: s.label, sub: s.sub, tone: s.tone ?? "teal" });
    });
  });

  // arrows between consecutive steps, in column order across all lanes
  const all = [];
  lanesIn.forEach((lane, li) => lane.steps.forEach((s) => all.push({ ...s, lane: li })));
  all.sort((a, b) => a.col - b.col);
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i];
    const b = all[i + 1];
    if (b.col <= a.col) continue;
    const ax = labelW + a.col * colW + 11 + boxW;
    const ay = topPad + a.lane * laneH + boxH / 2;
    const bx = labelW + b.col * colW + 11;
    const by = topPad + b.lane * laneH + boxH / 2;
    if (a.lane === b.lane) body += arrow(ax + 4, ay, bx - 6, by);
    else body += `<path d="M ${ax + 4} ${ay} H ${(ax + bx) / 2} V ${by} H ${bx - 6}" fill="none" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ah)"/>`;
  }
  return svg(width, height, body);
}

module.exports = { svg, box, diamond, arrow, elbow, caption, chain, lanes, wrap, TONES, INK, MUTED, LINE };
