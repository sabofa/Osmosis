import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import { PAPER_TYPES, type PaperSettings, type PaperType } from '../tokens'
import { defaultTheme } from '../theme/adapter'
import { PAPERS } from './index'

// The nine papers: each lays its background under everything, covering far
// more than the figure so panning never finds an edge.

const VIEW = { x: -350, y: -250, width: 700, height: 500 }

const lay = (type: PaperType, overrides: Partial<PaperSettings> = {}) =>
  PAPERS[type].draw({
    settings: { type, tint: '#fbf8f0', texture: 0.5, grid: 24, ...overrides },
    tint: '#fbf8f0',
    view: VIEW,
    id: (name) => `P-${name}`,
    colour: (hex) => hex,
    random: randomFor('paper', 0),
    theme: defaultTheme('light'),
    seed: 0,
  })

const number = (markup: string, attribute: string) => Number(new RegExp(`\\b${attribute}="([^"]+)"`).exec(markup)?.[1])

describe('every paper', () => {
  for (const type of PAPER_TYPES) {
    it(`${type} is deterministic and well-formed`, () => {
      expect(lay(type)).toEqual(lay(type))
      const all = [...lay(type).defs, ...lay(type).background].join('')
      expect(all).not.toMatch(/NaN|Infinity|undefined/)
      // Every id it references, it defines.
      for (const match of all.matchAll(/url\(#([^)]+)\)/g)) expect(all).toContain(`id="${match[1]}"`)
    })

    if (type === 'none') continue

    it(`${type} covers at least three view boxes beyond the figure in every direction`, () => {
      const [first] = lay(type).background
      expect(first).toMatch(/^<rect/)
      const x = number(first, 'x')
      const y = number(first, 'y')
      const width = number(first, 'width')
      const height = number(first, 'height')
      expect(x).toBeLessThanOrEqual(VIEW.x - 3 * VIEW.width)
      expect(y).toBeLessThanOrEqual(VIEW.y - 3 * VIEW.height)
      expect(x + width).toBeGreaterThanOrEqual(VIEW.x + 4 * VIEW.width)
      expect(y + height).toBeGreaterThanOrEqual(VIEW.y + 4 * VIEW.height)
      // Every layer of it, not only the first.
      for (const layer of lay(type).background.filter((m) => m.startsWith('<rect'))) {
        expect(number(layer, 'width')).toBeGreaterThanOrEqual(7 * VIEW.width)
        expect(number(layer, 'height')).toBeGreaterThanOrEqual(7 * VIEW.height)
      }
    })

    it(`${type} is laid in the paper's tint`, () => {
      expect(lay(type).background[0]).toContain('fill="#fbf8f0"')
    })
  }

  it('none lays nothing at all', () => {
    expect(lay('none')).toEqual({ defs: [], background: [] })
  })

  it('clean is the tint alone', () => {
    const clean = lay('clean')
    expect(clean.defs).toEqual([])
    expect(clean.background).toHaveLength(1)
  })

  // The ruling follows `grid`: a pattern tile one grid square (dots, ruling)
  // or five (graph: a major square of five minor ones).
  for (const [type, multiple] of [['graph', 5], ['rough-graph', 5], ['dotted', 1], ['ruled', 1]] as const) {
    it(`${type} spaces its ruling by grid`, () => {
      for (const grid of [12, 30]) {
        const pattern = lay(type, { grid }).defs.find((d) => d.startsWith('<pattern') && d.includes(`id="P-${type === 'rough-graph' ? 'rough-graph' : type}"`))
        expect(pattern, `${type} at ${grid}`).toBeDefined()
        if (type !== 'ruled') expect(number(pattern!, 'width')).toBeCloseTo(multiple * grid, 9)
        expect(number(pattern!, 'height')).toBeCloseTo(multiple * grid, 9)
      }
    })
  }

  it('ruled draws a margin line', () => {
    expect(lay('ruled').background.some((m) => m.startsWith('<line') || m.includes('data-paper="margin"'))).toBe(true)
  })

  it('textured papers grow fainter as texture falls', () => {
    for (const type of ['paper', 'rough-paper', 'canvas'] as const) {
      expect(lay(type, { texture: 0.9 })).not.toEqual(lay(type, { texture: 0.1 }))
    }
  })
})
