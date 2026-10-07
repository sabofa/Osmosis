import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import { PAPER_TYPES, type PaperSettings, type PaperType } from '../tokens'
import { defaultTheme } from '../theme/adapter'
import { paperKeysIn, parsePaperKey } from './generated'
import { PAPERS } from './index'

// The papers by name: each lays its background under everything, covering far more than the figure so panning never
// finds an edge. All but none and clean are the generated papers (generated.ts), found by their keys.

const VIEW = { x: -350, y: -250, width: 700, height: 500 }

const lay = (type: PaperType, overrides: Partial<PaperSettings> = {}) =>
  PAPERS[type].draw({
    settings: { type, tint: 'theme', texture: 0.5, grid: 24, tile: 512, ...overrides },
    tint: '#fbf8f0',
    view: VIEW,
    id: (name) => `P-${name}`,
    colour: (hex) => hex,
    random: randomFor('paper', 0),
    theme: defaultTheme('light'),
    seed: 0,
  })

const number = (markup: string, attribute: string) => Number(new RegExp(`\\b${attribute}="([^"]+)"`).exec(markup)?.[1])
const GENERATED = PAPER_TYPES.filter((type) => type !== 'none' && type !== 'clean')
const isCover = (markup: string) => markup.startsWith('<rect') && number(markup, 'width') >= 7 * VIEW.width && number(markup, 'height') >= 7 * VIEW.height

// Each old name, and the generated type it now draws.
const DRAWS: Record<string, string> = {
  paper: 'paperFine',
  'rough-paper': 'paperRough',
  canvas: 'canvas',
  graph: 'graphPaper',
  'rough-graph': 'graphPaper',
  dotted: 'dotted',
  ruled: 'notebook',
  kraft: 'kraft',
  linen: 'linen',
  blackboard: 'blackboard',
  greenboard: 'greenboard',
  whiteboard: 'whiteboard',
}

describe('every paper', () => {
  for (const type of PAPER_TYPES) {
    it(`${type} is deterministic and well-formed`, () => {
      expect(lay(type)).toEqual(lay(type))
      const all = [...lay(type).defs, ...lay(type).background].join('')
      expect(all).not.toMatch(/NaN|Infinity|undefined/)
      // Every id it references, it defines.
      for (const match of all.matchAll(/url\(#([^)]+)\)/g)) expect(all).toContain(`id="${match[1]}"`)
    })
  }

  it('kraft and linen are papers', () => {
    expect(PAPER_TYPES).toContain('kraft')
    expect(PAPER_TYPES).toContain('linen')
  })

  it('none lays nothing at all', () => {
    expect(lay('none')).toEqual({ defs: [], background: [] })
  })

  it('clean is the tint alone', () => {
    const clean = lay('clean')
    expect(clean.defs).toEqual([])
    expect(clean.background).toHaveLength(1)
    expect(clean.background[0]).toContain('fill="#fbf8f0"')
  })
})

describe('the generated papers', () => {
  for (const type of GENERATED) {
    it(`${type} draws ${DRAWS[type]}: a flat sheet, then one tile pattern over it`, () => {
      const { defs, background } = lay(type)
      const [flat, tiled] = background
      expect(flat).toMatch(/^<rect/)
      expect(tiled).toContain(`fill="url(#P-tile)"`)
      expect(defs.find((d) => d.startsWith('<pattern') && d.includes('id="P-tile"'))).toBeDefined()
      const keys = paperKeysIn([...defs, ...background].join(''))
      expect(keys).toHaveLength(1)
      expect(parsePaperKey(keys[0])?.type).toBe(DRAWS[type])
    })

    it(`${type} lays a flat rect under every pattern, each covering three view boxes beyond the figure`, () => {
      const covers = lay(type).background.filter(isCover)
      expect(covers.length).toBeGreaterThanOrEqual(2)
      for (const layer of covers) {
        expect(number(layer, 'x')).toBeLessThanOrEqual(VIEW.x - 3 * VIEW.width)
        expect(number(layer, 'y')).toBeLessThanOrEqual(VIEW.y - 3 * VIEW.height)
        expect(number(layer, 'x') + number(layer, 'width')).toBeGreaterThanOrEqual(VIEW.x + 4 * VIEW.width)
        expect(number(layer, 'y') + number(layer, 'height')).toBeGreaterThanOrEqual(VIEW.y + 4 * VIEW.height)
      }
    })

    it(`${type}'s tile is the tile setting, and it is in the key`, () => {
      for (const tile of [256, 1024]) {
        const keys = paperKeysIn(lay(type, { tile }).defs.join(''))
        expect(parsePaperKey(keys[0])?.size).toBe(tile)
        expect(lay(type, { tile }).defs.join('')).toContain(`width="${tile}" height="${tile}" patternUnits`)
      }
    })

    it(`${type} is keyed by texture`, () => {
      expect(paperKeysIn(lay(type, { texture: 0.9 }).defs.join(''))).not.toEqual(paperKeysIn(lay(type, { texture: 0.1 }).defs.join('')))
    })
  }

  it('every old name parses back to the generated type it draws', () => {
    for (const [name, generated] of Object.entries(DRAWS)) {
      const keys = paperKeysIn(lay(name as PaperType).defs.join(''))
      expect(parsePaperKey(keys[0]), name).not.toBeNull()
      expect(parsePaperKey(keys[0])!.type, name).toBe(generated)
    }
  })

  it('paper and rough-paper are different sheets', () => {
    expect(paperKeysIn(lay('paper').defs.join(''))).not.toEqual(paperKeysIn(lay('rough-paper').defs.join('')))
  })

  it('the three boards are a board colour, not the tint', () => {
    for (const board of ['blackboard', 'greenboard', 'whiteboard'] as const) expect(lay(board).background[0]).not.toContain('fill="#fbf8f0"')
  })

  it('the tray dust is a rect that does not cover the sheet, and only the dark boards have it', () => {
    for (const board of ['blackboard', 'greenboard'] as const) {
      const tray = lay(board).background.find((m) => m.includes('data-paper="tray"'))
      expect(tray, board).toBeDefined()
      const band = /<rect[^>]*>/.exec(tray!)![0]
      expect(isCover(band)).toBe(false)
    }
    expect(lay('whiteboard').background.some((m) => m.includes('data-paper="tray"'))).toBe(false)
  })

  // The ruling follows `grid`: a pattern tile one grid square (dots, ruling) or ten (graph's tile holds ten).
  for (const type of ['graph', 'rough-graph', 'dotted', 'ruled'] as const) {
    it(`${type} spaces its ruling by grid`, () => {
      for (const grid of [12, 30]) {
        const rules = lay(type, { grid }).defs.find((d) => d.startsWith('<pattern') && d.includes('id="P-rules"'))
        expect(rules, `${type} at ${grid}`).toBeDefined()
        const open = /^<pattern[^>]*>/.exec(rules!)![0]
        expect(number(open, 'width')).toBeCloseTo(10 * grid, 9)
        expect(number(open, 'height')).toBeCloseTo(10 * grid, 9)
      }
    })
  }

  it('ruled draws a margin line', () => {
    expect(lay('ruled').background.some((m) => m.includes('data-paper="margin"'))).toBe(true)
  })

  it('rough-graph is ruled with a rougher hand than graph', () => {
    expect(lay('rough-graph').defs.join('')).not.toEqual(lay('graph').defs.join(''))
  })

  it('papers with no rulings have none', () => {
    for (const type of ['paper', 'rough-paper', 'canvas', 'kraft', 'linen'] as const) expect(lay(type).defs.join('')).not.toContain('id="P-rules"')
  })
})
