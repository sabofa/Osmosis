import { describe, expect, it } from 'vitest'
import { PRESET_NAMES, PRESETS } from './presets'
import { readToken, TOKENS } from './tokens'

// Every preset is a COMPLETE look: a value for every token, inside its range.
// A preset missing a token would inherit whatever the layer below it said,
// which would make "@style: pencil" mean different things in different apps.
describe('presets', () => {
  it('are the four first looks, clean first', () => {
    expect(PRESET_NAMES).toEqual(['clean', 'ink', 'pencil', 'marker'])
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
    expect(PRESETS.clean.colour).toEqual({ ink: 'theme', saturation: 1 })
    // The spec's table says "math" for clean, but its first rule says clean is
    // today's output byte for byte, and today's labels are set in a sans. The
    // rule wins: clean letters in "textbook", whose stack IS today's.
    expect(PRESETS.clean.lettering).toEqual({ face: 'textbook', size: 1, tilt: 0 })

    expect(PRESETS.ink.line).toMatchObject({ type: 'ink', looseness: 0.25, wobble: 0.3, variation: 0.4 })
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
})
