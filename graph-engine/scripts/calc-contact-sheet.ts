// The calc contact sheet: the torture corpus (src/plot/testing/corpus.ts), each case built by the real engine
// at its main view and drawn as SVG (src/plot/testing/svgScene.ts), as standalone HTML pages for headless
// screenshots. The grid is 4 across, 4 down to a page, each cell 320 x 320 px, captioned with the case's
// name, the work it did against its pinned ceiling, and its view.
//
//   npx vite-node graph-engine/scripts/calc-contact-sheet.ts <out dir>
//
// writes <out dir>/calc-sheet-<n>.html. Then, for each page, a PNG (PowerShell, headless Edge, a fresh
// profile each time; a page is about 1700 px tall):
//
//   Start-Process -Wait -NoNewWindow -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
//     -ArgumentList @('--headless=new','--disable-gpu','--hide-scrollbars','--user-data-dir=<fresh dir>',
//                     '--window-size=1440,1800','--virtual-time-budget=4000','--screenshot=<out.png>','file:///<page.html>')
//
// Exits 1 if any case has an error it did not expect (parse errors included), a note it expects and does not
// have, or a NaN or an Infinity in its SVG. A case's own notes ("drawn coarsely: ...", expected by the case) are
// shown on its cell, not counted.
import { mkdirSync, writeFileSync } from 'node:fs'
import { CORPUS, type CorpusCase } from '../src/plot/testing/corpus'
import { sceneToSvg } from '../src/plot/testing/svgScene'
import { parseSpec } from '../src/parser/parseSpec'
import { buildScene } from '../src/scene/buildScene'

const COLUMNS = 4
const ROWS_PER_PAGE = 4
const CELL_PX = 320

interface Cell {
  name: string
  svg: string
  caption: string
  notes: string[]
  problems: string[]
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function cellOf(c: CorpusCase): Cell {
  const v = c.views[0]
  const parsed = parseSpec(c.spec)
  const scene = buildScene(parsed.statements, v.bounds, parsed.config, undefined, parsed.statementLines, { widthPx: v.widthPx, heightPx: v.heightPx, quality: c.quality ?? 'full', budget: c.budget })
  const svg = sceneToSvg(scene, v, { markRadius: 9 })
  const expected = c.expect.notes ?? []
  const messages = scene.errors.map((e) => e.message)
  // a message is expected when the case names it, in order, by its prefix; and a note the case names that is not there is a problem too
  const unexpected = messages.filter((m, i) => !(i < expected.length && m.startsWith(expected[i])))
  const missing = expected.filter((prefix, i) => !(i < messages.length && messages[i].startsWith(prefix)))
  const problems = [...parsed.errors.map((e) => `line ${e.line}: ${e.message}`), ...unexpected, ...missing.map((prefix) => `the note "${prefix}..." is expected and is missing`)]
  if (/NaN|Infinity/.test(svg)) problems.push('the SVG holds a NaN or an Infinity')
  const { xMin, xMax, yMin, yMax } = v.bounds
  const stats = scene.stats ?? { points: 0, intervals: 0 }
  const caption =
    `<b>${escapeHtml(c.name)}</b>` +
    `<span>points ${stats.points} / ${c.ceiling.points} · intervals ${stats.intervals} / ${c.ceiling.intervals}${c.quality === 'coarse' ? ' · COARSE' : ''}</span>` +
    `<span>x ${xMin} to ${xMax}, y ${yMin} to ${yMax} · ${v.widthPx} × ${v.heightPx} px${c.views.length > 1 ? ` · ${c.views.length} views` : ''}</span>`
  return { name: c.name, svg, caption, notes: messages.filter((m) => !unexpected.includes(m)), problems }
}

const CSS = `
html,body{margin:0}
body{background:#eef1e5;color:#17170f;font-family:Inter,system-ui,"Segoe UI",sans-serif;padding:20px 24px 28px}
h1{font-size:20px;font-weight:600;margin:0 0 2px}
.lede{color:#6b6b5f;font-size:12px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(${COLUMNS},${CELL_PX}px);gap:14px 12px}
figure{margin:0}
.cell{width:${CELL_PX}px;height:${CELL_PX}px;background:#fdf6ea;border:1px solid #d7d4c2;border-radius:8px;overflow:hidden;position:relative}
.cell svg{width:${CELL_PX}px;height:${CELL_PX}px;display:block}
figcaption{display:flex;flex-direction:column;gap:1px;margin-top:5px;font-size:11px;line-height:1.3;color:#6b6b5f}
figcaption b{color:#17170f;font-size:12px}
.note{color:#8a5a00}
.problem{color:#b3261e;font-weight:600}
`

function pageHtml(cells: readonly Cell[], page: number, pages: number): string {
  const figures = cells
    .map((cell) => {
      const notes = cell.notes.map((n) => `<span class="note">note: ${escapeHtml(n)}</span>`).join('')
      const problems = cell.problems.map((p) => `<span class="problem">${escapeHtml(p)}</span>`).join('')
      return `<figure><div class="cell" title="${escapeHtml(cell.name)}">${cell.svg}</div><figcaption>${cell.caption}${notes}${problems}</figcaption></figure>`
    })
    .join('')
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Calc P2 — torture corpus</title>',
    `<style>${CSS}</style></head><body>`,
    `<h1>Calc P2 — torture corpus, page ${page} of ${pages}</h1>`,
    '<p class="lede">Each cell is the real engine at the case’s main view, drawn as the viewer draws it: rings for open marks, dots for filled, dashed guides, bands filled at 0.18.</p>',
    `<div class="grid">${figures}</div>`,
    '</body></html>',
  ].join('')
}

const dir = process.argv[2] ?? 'calc-sheet'
mkdirSync(dir, { recursive: true })
const cells = CORPUS.map(cellOf)
const perPage = COLUMNS * ROWS_PER_PAGE
const pages = Math.ceil(cells.length / perPage)
for (let p = 0; p < pages; p++) {
  const file = `${dir}/calc-sheet-${p + 1}.html`
  writeFileSync(file, pageHtml(cells.slice(p * perPage, (p + 1) * perPage), p + 1, pages))
  console.log(`wrote ${file}`)
}
const failed = cells.filter((c) => c.problems.length > 0)
console.log(`${cells.length} cases on ${pages} pages, ${failed.length} with problems`)
for (const cell of failed) console.log(`  ${cell.name}: ${cell.problems.join('; ')}`)
process.exit(failed.length > 0 ? 1 : 0)
