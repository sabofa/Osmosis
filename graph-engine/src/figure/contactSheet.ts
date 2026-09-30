import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE, type Palette } from '../render/palette'
import { FILL_TYPES, LINE_TYPES, LETTERING_FACES, PAPER_TYPES } from '../style/tokens'
import { PRESET_NAMES } from '../style/presets'
import { renderFigure } from './render'

// The contact sheet: representative figures drawn in every look, side by
// side, for judging the styles by eye.
//
// One module serves both places the sheet is shown — the style lab's "Sheet"
// tab (review/src/styleLab.tsx) and the headless script
// (scripts/contact-sheet.ts), which writes the same sheet as a standalone
// HTML page for a screenshot — so the two can never show different things.
// Pure: specs in, SVG strings out, no DOM.

// The eight representative figures: a triangle with measures, circle
// vocabulary, the cube with its net, a shaded region, a cone with a sphere,
// an oblique section, the AIME tetrahedron, and a plain construction.
export const SHEET_EXAMPLES = [
  'Measured + notation',
  'Circle vocabulary',
  'Cube and its net',
  'Square minus its circle',
  'Sphere in a cone',
  'Cube: the hexagonal section',
  'AIME tetrahedron',
  'Constructions',
] as const

export interface SheetCell {
  caption: string
  svg: string
  errors: string[]
}

export interface SheetSection {
  title: string
  note: string
  columns: string[]
  rows: { label: string; cells: SheetCell[] }[]
  // Lay each row out `wrap` cells to a line, each captioned with its column,
  // instead of one line under a header: big enough to see a line type's
  // character, which a seventh of the page is not.
  wrap?: number
}

// A figure made to show a LINE: long straight strokes, a circle, an angle
// arc, ticks, a right-angle mark and a dashed line, at a heavier weight.
export const LINE_DEMO = `@mode: figure
A = (0, 0)
B = (6, 0)
C = (1.6, 4)
segment: A-B
segment: B-C
segment: C-A
D = foot C to A-B
segment: C-D dashed
right-angle: C-D-B
circle: (3.5, 1.35), 1.05
angle: B-A-C
tick: A-C
tick: B-C
label: AB`

function exampleSpec(label: string): string {
  const example = EXAMPLES.find((e) => e.label === label)
  if (!example) throw new Error(`No example "${label}"`)
  return example.spec
}

// One figure: the example's spec under `directives`, which come first so an
// example's own "@style…" lines (the Styles group has some) still win.
export function sheetCell(caption: string, spec: string, directives: readonly string[], palette: Palette = LIGHT_PALETTE): SheetCell {
  const parsed = parseSpec([...directives, spec].join('\n'))
  const result = renderFigure(parsed.statements, parsed.config, palette)
  return { caption, svg: result.svg, errors: [...parsed.errors, ...result.errors].map((e) => e.message) }
}

const row = (label: string, columns: readonly string[], make: (column: string) => SheetCell) => ({ label, cells: columns.map(make) })

export function contactSheet(palette: Palette = LIGHT_PALETTE): SheetSection[] {
  const presets = [...PRESET_NAMES]
  return [
    {
      title: 'Presets',
      note: 'Eight representative figures, each in every preset.',
      columns: presets,
      rows: SHEET_EXAMPLES.map((label) => row(label, presets, (preset) => sheetCell(`${label} · ${preset}`, exampleSpec(label), [`@style: ${preset}`], palette))),
    },
    {
      title: 'Line types',
      note: 'The ink preset with each line type, a little heavier (width 1.5), on clean paper. Dashed and hidden lines are dashed in the line type.',
      columns: [...LINE_TYPES],
      wrap: 3,
      rows: [
        row('A triangle, drawn', LINE_TYPES, (line) =>
          sheetCell(`line · ${line}`, LINE_DEMO, ['@style: ink', `@style-line: ${line}`, '@style-line-width: 1.5', '@style-paper: clean'], palette)
        ),
        row('Cylinder and cone', LINE_TYPES, (line) =>
          sheetCell(`Cylinder and cone · ${line}`, exampleSpec('Cylinder and cone'), ['@style: ink', `@style-line: ${line}`, '@style-paper: clean'], palette)
        ),
      ],
    },
    {
      title: 'Fills',
      note: 'Each fill under the ink preset: marks drawn in the line type, clipped to the exact region; the annulus keeps its hole.',
      columns: [...FILL_TYPES],
      wrap: 4,
      rows: ['Square minus its circle', 'Annulus'].map((label) =>
        row(label, FILL_TYPES, (fill) => sheetCell(`${label} · ${fill}`, exampleSpec(label), ['@style: ink', `@style-fill: ${fill}`], palette))
      ),
    },
    {
      title: 'Papers',
      note: 'Each paper under the ink preset. Every paper covers three view boxes beyond the figure, so panning never finds an edge.',
      columns: [...PAPER_TYPES],
      wrap: 3,
      rows: [row('Triangle', PAPER_TYPES, (paper) => sheetCell(`paper · ${paper}`, exampleSpec('Triangle'), ['@style: ink', `@style-paper: ${paper}`], palette))],
    },
    {
      title: 'Lettering',
      note: 'Each face, at full tilt (at most 4°, about the label’s own anchor).',
      columns: [...LETTERING_FACES],
      rows: [
        row('Givens table', LETTERING_FACES, (face) =>
          sheetCell(`lettering · ${face}`, exampleSpec('Givens table'), ['@style: pencil', `@style-lettering: ${face}`, '@style-tilt: 1'], palette)
        ),
      ],
    },
    {
      title: 'Looseness',
      note: 'The pencil preset from exact (0) to loose (1). At 0 every stroke starts and ends on its true point.',
      columns: ['0', '0.3', '0.6', '1'],
      rows: [
        row('Measured + notation', ['0', '0.3', '0.6', '1'], (value) =>
          sheetCell(`looseness · ${value}`, exampleSpec('Measured + notation'), ['@style: pencil', `@style-looseness: ${value}`], palette)
        ),
      ],
    },
  ]
}

// The sheet's own look: the review harness's paper-and-ink tokens.
export const SHEET_CSS = `
.sheet { --sheet-bg: #eef1e5; --sheet-card: #ffffff; --sheet-ink: #17170f; --sheet-muted: #6b6b5f; --sheet-line: #d7d4c2; --sheet-accent: #c65d22;
  background: var(--sheet-bg); color: var(--sheet-ink); font-family: Inter, system-ui, sans-serif; padding: 28px 32px 48px; }
.sheet h1 { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
.sheet .sheet-lede { color: var(--sheet-muted); font-size: 14px; margin: 0 0 28px; }
.sheet section { margin: 0 0 36px; }
.sheet h2 { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 600; margin: 0 0 2px; display: flex; align-items: baseline; gap: 10px; }
.sheet h2 small { font-family: Inter, sans-serif; font-weight: 400; font-size: 13px; color: var(--sheet-muted); }
.sheet .sheet-grid { display: grid; gap: 10px; margin-top: 12px; }
.sheet .sheet-head { font: 600 11px/1 Inter, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sheet-muted); padding: 0 2px 2px; }
.sheet .sheet-rowlabel { font: 500 12px/1.3 Inter, sans-serif; color: var(--sheet-muted); align-self: center; }
.sheet .sheet-block { margin-top: 14px; }
.sheet .sheet-block > .sheet-rowlabel { margin: 0 0 -4px; }
.sheet .sheet-figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.sheet .sheet-cell { background: #fdf6ea; border: 1px solid var(--sheet-line); border-radius: 10px; overflow: hidden; aspect-ratio: 4 / 3; position: relative; box-shadow: 0 1px 0 rgb(0 0 0 / 0.03); }
.sheet .sheet-cell svg { width: 100%; height: 100%; display: block; }
.sheet .sheet-cell .sheet-error { position: absolute; inset: auto 0 0 0; background: #b3261e; color: #fff; font-size: 11px; padding: 4px 8px; }
`

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The sheet as HTML: one section per heading, a header row of columns, and a
// labelled row of figures under it.
export function sheetSectionsHtml(sections: readonly SheetSection[]): string {
  return sections
    .map((section) => {
      if (section.wrap) {
        const blocks = section.rows
          .map((r) => {
            const cells = r.cells
              .map(
                (cell, i) =>
                  `<figure class="sheet-figure"><figcaption class="sheet-head">${escapeHtml(section.columns[i])}</figcaption><div class="sheet-cell" title="${escapeHtml(cell.caption)}">${cell.svg}${cell.errors.length > 0 ? `<div class="sheet-error">${escapeHtml(cell.errors.join('; '))}</div>` : ''}</div></figure>`
              )
              .join('')
            return `<div class="sheet-block"><div class="sheet-rowlabel">${escapeHtml(r.label)}</div><div class="sheet-grid" style="grid-template-columns: repeat(${section.wrap}, minmax(0, 1fr))">${cells}</div></div>`
          })
          .join('')
        return `<section><h2>${escapeHtml(section.title)} <small>${escapeHtml(section.note)}</small></h2>${blocks}</section>`
      }
      const template = `grid-template-columns: 150px repeat(${section.columns.length}, minmax(0, 1fr))`
      const head = ['<div></div>', ...section.columns.map((c) => `<div class="sheet-head">${escapeHtml(c)}</div>`)].join('')
      const rows = section.rows
        .map(
          (r) =>
            `<div class="sheet-rowlabel">${escapeHtml(r.label)}</div>` +
            r.cells
              .map((cell) => `<div class="sheet-cell" title="${escapeHtml(cell.caption)}">${cell.svg}${cell.errors.length > 0 ? `<div class="sheet-error">${escapeHtml(cell.errors.join('; '))}</div>` : ''}</div>`)
              .join('')
        )
        .join('')
      return `<section><h2>${escapeHtml(section.title)} <small>${escapeHtml(section.note)}</small></h2><div class="sheet-grid" style="${template}">${head}${rows}</div></section>`
    })
    .join('')
}

// A standalone page, fonts and all, for the headless screenshot.
export function contactSheetHtml(sections: readonly SheetSection[]): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Figure styles — contact sheet</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400..700&family=Patrick+Hand&family=STIX+Two+Text:ital,wght@0,400..700;1,400..700&family=Space+Grotesk:wght@400..700&family=Inter:wght@400..700&display=block" rel="stylesheet">',
    `<style>html,body{margin:0}${SHEET_CSS}</style></head><body><div class="sheet">`,
    '<h1>Figure styles — contact sheet</h1><p class="sheet-lede">Every figure is drawn by the engine’s own renderer; clean is today’s output, byte for byte.</p>',
    sheetSectionsHtml(sections),
    '</div></body></html>',
  ].join('')
}

// The sheet as several pages, one per section and the presets in two halves,
// each short enough for headless Edge to paint whole: a single page of the
// whole sheet is some 13 000 px tall, and Edge paints nothing past about
// 8 000. The script writes these; the style lab shows the whole sheet.
export function contactSheetPages(sections: readonly SheetSection[]): { name: string; html: string }[] {
  const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return sections.flatMap((section) => {
    if (section.rows.length <= 4) return [{ name: slug(section.title), html: contactSheetHtml([section]) }]
    const pages: { name: string; html: string }[] = []
    for (let start = 0; start < section.rows.length; start += 4) {
      const part = start / 4 + 1
      const title = part === 1 ? section.title : `${section.title} (continued)`
      pages.push({ name: `${slug(section.title)}-${part}`, html: contactSheetHtml([{ ...section, title, rows: section.rows.slice(start, start + 4) }]) })
    }
    return pages
  })
}
