// The figure-styles contact sheet, as a standalone HTML page — the same sheet
// the style lab's "Sheet" tab shows — for a headless screenshot.
//
//   npx vite-node graph-engine/scripts/contact-sheet.ts <out.html>
//
// then, for a PNG (PowerShell, headless Edge, a fresh profile each time):
//
//   Start-Process -Wait -NoNewWindow -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
//     -ArgumentList @('--headless=new','--disable-gpu','--hide-scrollbars','--user-data-dir=<fresh dir>',
//                     '--window-size=2000,<h>','--virtual-time-budget=8000','--screenshot=<out.png>','file:///<out.html>')
import { writeFileSync } from 'node:fs'
import { contactSheet, contactSheetHtml } from '../src/figure/contactSheet'

const out = process.argv[2] ?? 'contact-sheet.html'
const sections = contactSheet()
writeFileSync(out, contactSheetHtml(sections))
const cells = sections.flatMap((s) => s.rows.flatMap((r) => r.cells))
const failed = cells.filter((c) => c.errors.length > 0 || /NaN|Infinity/.test(c.svg))
console.log(`wrote ${out}: ${cells.length} figures, ${failed.length} with errors`)
for (const cell of failed) console.log(`  ${cell.caption}: ${cell.errors.join('; ')}`)
process.exit(failed.length > 0 ? 1 : 0)
