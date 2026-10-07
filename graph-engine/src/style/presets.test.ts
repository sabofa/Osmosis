import { describe, expect, it } from 'vitest'
import { MEDIA } from './media'
import { PRESET_NAMES, PRESETS } from './presets'
import { BOARD_NAMES, MEDIUM_NAMES } from './theme/types'
import { PAPER_TYPES, readToken, TOKENS } from './tokens'

// Every preset is a COMPLETE look: a value for every token, inside its range.
// A preset missing a token would inherit whatever the layer below it said,
// which would make "@style: pencil" mean different things in different apps.
describe('presets', () => {
  it('are the eight looks, clean first, the four first looks next', () => {
    expect(PRESET_NAMES).toEqual(['clean', 'ink', 'pencil', 'marker', 'colouredPencil', 'blackboard', 'greenboard', 'whiteboard'])
  })

  for (const name of PRESET_NAMES) {
    it(`${name} sets every token, within its range`, () => {
      const preset = PRESETS[name]
      for (const token of TOKENS) {
        if (token.group === 'seed') continue
        const value = readToken(preset, token)
        expect(value, `${name} ${token.directive}`).not.toBeUndefined()
        if (token.kind === 'choice') expect(token.choices, `${name} ${token.directive}`).toContain(value)
        if (token.kind === 'number') {
          expect(typeof value, `${name} ${token.directive}`).toBe('number')
          expect(value as number, `${name} ${token.directive}`).toBeGreaterThanOrEqual(token.min)
          expect(value as number, `${name} ${token.directive}`).toBeLessThanOrEqual(token.max)
          if (token.integer) expect(Number.isInteger(value), `${name} ${token.directive}`).toBe(true)
        }
        if (token.kind === 'colour') expect(value, `${name} ${token.directive}`).toMatch(/^(theme|#[0-9a-f]{6})$/)
      }
      // Nothing beyond the tokens either: a stray key would be a setting
      // no directive can reach and no lab control shows.
      for (const group of ['line', 'fill', 'paper', 'lettering', 'colour'] as const) {
        const keys = TOKENS.filter((t) => t.group === group).map((t) => t.key).sort()
        expect(Object.keys(preset[group]).sort(), `${name} ${group}`).toEqual(keys)
      }
    })
  }

  it('match the spec table where it speaks', () => {
    expect(PRESETS.clean.line.type).toBe('technical')
    expect(PRESETS.clean.line.looseness).toBe(0)
    expect(PRESETS.clean.fill.type).toBe('flat')
    expect(PRESETS.clean.paper.type).toBe('clean')
    expect(PRESETS.clean.colour).toEqual({ ink: 'theme', saturation: 1, medium: 'clean' })
    // The spec's table says "math" for clean, but its first rule says clean is
    // today's output byte for byte, and today's labels are set in a sans. The
    // rule wins: clean letters in "textbook", whose stack IS today's.
    expect(PRESETS.clean.lettering).toEqual({ face: 'textbook', size: 1, tilt: 0 })

    expect(PRESETS.ink.line).toMatchObject({ type: 'ink', looseness: 0.25, wobble: 0.3, variation: 0.75, taper: 0.8 })
    expect(PRESETS.ink.line.passes).toBeLessThanOrEqual(2)
    expect(PRESETS.ink.fill.type).toBe('hatch')
    expect(PRESETS.ink.paper.type).toBe('paper')
    expect(PRESETS.ink.lettering.face).toBe('math')
    expect(PRESETS.ink.colour.saturation).toBe(0.9)

    expect(PRESETS.pencil.line).toMatchObject({ type: 'pencil', looseness: 0.3, passes: 2, grain: 0.6, opacity: 0.85 })
    expect(PRESETS.pencil.fill.type).toBe('hatch')
    expect(PRESETS.pencil.paper.type).toBe('rough-paper')
    expect(PRESETS.pencil.lettering.face).toBe('hand')
    expect(PRESETS.pencil.colour.saturation).toBe(0.4)

    expect(PRESETS.marker.line).toMatchObject({ type: 'marker', looseness: 0.2, width: 1.8, variation: 0.2 })
    expect(PRESETS.marker.fill.type).toBe('scribble')
    expect(PRESETS.marker.paper.type).toBe('ruled')
    expect(PRESETS.marker.lettering.face).toBe('hand')
    expect(PRESETS.marker.colour.saturation).toBe(1.1)
  })

  // The design's table of the new looks (line, fill, paper, medium, lettering).
  it('lay the new looks as the design says', () => {
    const table: Record<string, [string, string, string, string, string]> = {
      colouredPencil: ['pencil', 'hatch', 'paper', 'colouredPencil', 'hand'],
      blackboard: ['chalk', 'scribble', 'blackboard', 'chalk', 'hand'],
      greenboard: ['chalk', 'scribble', 'greenboard', 'chalk', 'hand'],
      // The chisel outline and the fill-in arrive with the whiteboard brushes: the marker line and the scribble stand in.
      whiteboard: ['marker', 'scribble', 'whiteboard', 'whiteboard', 'hand'],
    }
    for (const [name, [line, fill, paper, medium, face]] of Object.entries(table)) {
      const preset = PRESETS[name as keyof typeof PRESETS]
      expect([preset.line.type, preset.fill.type, preset.paper.type, preset.colour.medium, preset.lettering.face], name).toEqual([line, fill, paper, medium, face])
    }
  })

  // The ink, pencil and marker take their colours from their medium, so they follow the theme: what
  // they say about lines, fills and lettering is what it was (colour.ink and paper.tint were the hexes).
  it('keep every line, fill and lettering value of the first looks, and take their colours from the theme through a medium', () => {
    expect(PRESETS.ink).toMatchObject({
      line: { type: 'ink', looseness: 0.25, wobble: 0.3, passes: 1, width: 1.7, variation: 0.75, taper: 0.8, grain: 0, opacity: 1 },
      fill: { type: 'hatch', angle: 45, spacing: 8, opacity: 0.65, roughness: 0.45 },
      paper: { type: 'paper', texture: 0.45, grid: 24 },
      lettering: { face: 'math', size: 1.05, tilt: 0 },
    })
    expect(PRESETS.pencil).toMatchObject({
      line: { type: 'pencil', looseness: 0.3, wobble: 0.35, passes: 2, width: 1.25, variation: 0.3, taper: 0.4, grain: 0.6, opacity: 0.85 },
      fill: { type: 'hatch', angle: 55, spacing: 6.5, opacity: 0.9, roughness: 0.5 },
      paper: { type: 'rough-paper', texture: 0.6, grid: 24 },
      lettering: { face: 'hand', size: 1.2, tilt: 0.5 },
    })
    expect(PRESETS.marker).toMatchObject({
      line: { type: 'marker', looseness: 0.2, wobble: 0.15, passes: 1, width: 1.8, variation: 0.2, taper: 0, grain: 0.1, opacity: 0.85 },
      fill: { type: 'scribble', angle: 35, spacing: 9, opacity: 0.45, roughness: 0.6 },
      paper: { type: 'ruled', texture: 0.2, grid: 26 },
      lettering: { face: 'hand', size: 1.25, tilt: 0.4 },
    })
    for (const [name, medium] of [['ink', 'ink'], ['pencil', 'graphite'], ['marker', 'marker']] as const) {
      expect(PRESETS[name].colour.ink, name).toBe('theme')
      expect(PRESETS[name].paper.tint, name).toBe('theme')
      expect(PRESETS[name].colour.medium, name).toBe(medium)
    }
  })

  it('name a known medium, and a board look lays the board its medium is drawn on', () => {
    for (const name of PRESET_NAMES) expect(MEDIUM_NAMES, name).toContain(PRESETS[name].colour.medium)
    for (const name of ['blackboard', 'greenboard', 'whiteboard'] as const) {
      expect(BOARD_NAMES).toContain(PRESETS[name].paper.type)
      expect(PRESETS[name].paper.type).toBe(name)
      expect(MEDIA[PRESETS[name].colour.medium].surface === 'paper', name).toBe(false)
    }
    // Only the clean preset is in the clean medium; every other look draws in a medium of its own.
    expect(PRESET_NAMES.filter((name) => PRESETS[name].colour.medium === 'clean')).toEqual(['clean'])
  })

  it('keep the old paper names, and add the three boards', () => {
    for (const paper of ['none', 'clean', 'paper', 'rough-paper', 'canvas', 'graph', 'rough-graph', 'dotted', 'ruled']) expect(PAPER_TYPES, paper).toContain(paper)
    for (const board of BOARD_NAMES) expect(PAPER_TYPES, board).toContain(board)
  })
})
