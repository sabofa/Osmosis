import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { resolvePanels } from '../scene/mode'
import { PRESET_NAMES } from '../style/presets'
import { contactSheet, contactSheetHtml, contactSheetPages, SHEET_EXAMPLES, sheetCell } from './contactSheet'

// The contact sheet — the style lab's Sheet tab and the headless script draw
// the same one — and the promise behind it: every figure example draws in
// every preset with no errors and no non-finite numbers.

const FIGURES = EXAMPLES.filter((example) => {
  const parsed = parseSpec(example.spec)
  return resolvePanels(parsed.statements, parsed.config).drawable === 'figure'
})

describe('every figure example, in every preset', () => {
  it('covers the figure examples', () => {
    expect(FIGURES.length).toBeGreaterThan(50)
  })

  for (const example of FIGURES) {
    it(`${example.label} draws in ${PRESET_NAMES.join(', ')}`, () => {
      for (const preset of PRESET_NAMES) {
        const cell = sheetCell(example.label, example.spec, [`@style: ${preset}`])
        expect(cell.errors, `${example.label} in ${preset}`).toEqual([])
        expect(cell.svg, `${example.label} in ${preset}`).not.toMatch(/NaN|Infinity|undefined/)
        expect(cell.svg.startsWith('<svg ')).toBe(true)
      }
    })
  }
})

describe('the contact sheet', () => {
  const sections = contactSheet()

  it('draws the eight representative figures in every preset first', () => {
    expect(SHEET_EXAMPLES).toHaveLength(8)
    expect(sections[0].columns).toEqual([...PRESET_NAMES])
    expect(sections[0].rows.map((r) => r.label)).toEqual([...SHEET_EXAMPLES])
  })

  it('shows every line type, fill, paper and face', () => {
    const titles = sections.map((s) => s.title)
    expect(titles).toEqual(['Presets', 'Line types', 'Fills', 'Papers', 'Lettering', 'Looseness', 'Imperfection'])
    expect(sections[1].columns).toHaveLength(6)
    expect(sections[2].columns).toHaveLength(7)
    // The eleven papers, and the three boards.
    expect(sections[3].columns).toHaveLength(14)
    expect(sections[4].columns).toHaveLength(3)
    // Roughness 0, 0.5 and 1, mirroring the Looseness section.
    expect(sections[6].columns).toEqual(['0', '0.5', '1'])
    expect(sections[6].rows.map((r) => r.label)).toEqual(['hatch', 'crosshatch', 'scribble', 'stipple', 'flat', 'ink line · variation'])
  })

  it('draws every cell without errors or non-finite numbers', () => {
    for (const section of sections) {
      for (const row of section.rows) {
        expect(row.cells).toHaveLength(section.columns.length)
        for (const cell of row.cells) {
          expect(cell.errors, cell.caption).toEqual([])
          expect(cell.svg, cell.caption).not.toMatch(/NaN|Infinity|undefined/)
        }
      }
    }
  })

  it('splits into pages short enough to screenshot, together holding every figure', () => {
    const pages = contactSheetPages(sections)
    expect(pages.map((p) => p.name)).toEqual(['presets-1', 'presets-2', 'line-types', 'fills', 'papers', 'lettering', 'looseness', 'imperfection-1', 'imperfection-2'])
    const total = pages.reduce((n, p) => n + (p.html.match(/<svg /g)?.length ?? 0), 0)
    expect(total).toBe(sections.reduce((n, s) => n + s.rows.length * s.columns.length, 0))
    for (const page of pages) expect(page.html.startsWith('<!doctype html>')).toBe(true)
  })

  it('writes a standalone page with its fonts', () => {
    const html = contactSheetHtml(sections)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('family=Caveat')
    expect(html.match(/<svg /g)?.length).toBe(sections.reduce((n, s) => n + s.rows.length * s.columns.length, 0))
  })
})
