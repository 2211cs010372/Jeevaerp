# Staff manuals

One Word document per portal, written in Tenglish (Telugu in Latin script, English
screen names) for the people who actually work the counters.

| File | Portal | For |
|---|---|---|
| `Jeeva-Reception-Portal-User-Manual.docx` | `/reception` | Front desk |
| `Jeeva-Doctor-Portal-User-Manual.docx` | `/doctor` | Consultants |
| `Jeeva-Pharmacy-Portal-User-Manual.docx` | `/pharmacy` | Medicine counter |
| `Jeeva-Laboratory-Portal-User-Manual.docx` | `/labs` | Lab counter + bench |
| `Jeeva-Insurance-Desk-Portal-User-Manual.docx` | `/insurance` | Insurance room |
| `Jeeva-Admin-Console-User-Manual.docx` | `/admin` | Owner / administrator |

## Regenerating

```bash
npm i -D docx          # once - the only dependency that is not already here
node docs/manuals/build.js            # all six
node docs/manuals/build.js reception  # just one
```

`sharp` (already a Next.js dependency) rasterises the SVG diagrams to PNG; the
PNGs land in `diagrams/` and are embedded in the documents.

## Editing the content

The words live in `content/<portal>.js` as plain data — a list of blocks:

| Block | Renders as |
|---|---|
| `{ t: "h1" \| "h2" \| "h3", x }` | Heading (feeds the table of contents) |
| `{ t: "p", x }` / `{ t: "lead", x }` | Paragraph. `**bold**` and `` `code` `` work |
| `{ t: "ul", items }` / `{ t: "steps", items }` | Bullets / numbered steps |
| `{ t: "table", head, rows, widths }` | Table. `widths` are percentages, summing to 100 |
| `{ t: "note" \| "warn" \| "stop" \| "tip", title, lines }` | Tinted callout box |
| `{ t: "img", name, svg }` | A diagram, built with the helpers in `svg.js` |
| `{ t: "caption", x }` | Small centred line under a diagram |
| `{ t: "pb" }` | Page break |

Fixing a sentence is a one-line edit and a rebuild. Keep the six manuals on the
same block vocabulary — that is what stops them drifting into six layouts.

## When the software changes

A screen that gets a new button needs its manual paragraph changed in the same
week, or the manual starts teaching something that is not there any more — which
is worse than having no manual, because staff stop trusting all of it.
