// The figure-styles contact sheet — the same sheet the style lab's "Sheet"
// tab shows — written as standalone HTML pages, one per section (the presets
// in two halves), for headless screenshots.
//
//   npx vite-node graph-engine/scripts/contact-sheet.ts <out dir>
//
// writes <out dir>/contact-sheet-<section>.html. Then, for each page, a PNG
// (PowerShell, headless Edge, a fresh profile each time; about 2000 px tall
// is plenty for any one page):
//
//   Start-Process -Wait -NoNewWindow -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
//     -ArgumentList @('--headless=new','--disable-gpu','--hide-scrollbars','--user-data-dir=<fresh dir>',
//                     '--window-size=1800,2000','--virtual-time-budget=8000','--screenshot=<out.png>','file:///<page.html>')
//
// One page of the whole sheet would be some 13 000 px tall, and headless Edge
// paints nothing past about 8 000 — hence the pages.
import { mkdirSync, writeFileSync } from 'node:fs'
import { contactSheet, contactSheetPages } from '../src/figure/contactSheet'

const dir = process.argv[2] ?? 'contact-sheet'
mkdirSync(dir, { recursive: true })
const sections = contactSheet()
for (const page of contactSheetPages(sections)) {
  writeFileSync(`${dir}/contact-sheet-${page.name}.html`, page.html)
  console.log(`wrote ${dir}/contact-sheet-${page.name}.html`)
}
const cells = sections.flatMap((s) => s.rows.flatMap((r) => r.cells))
const failed = cells.filter((c) => c.errors.length > 0 || /NaN|Infinity/.test(c.svg))
console.log(`${cells.length} figures, ${failed.length} with errors`)
for (const cell of failed) console.log(`  ${cell.caption}: ${cell.errors.join('; ')}`)
process.exit(failed.length > 0 ? 1 : 0)
