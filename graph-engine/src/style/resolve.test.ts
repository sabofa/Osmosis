import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { PRESET_NAMES, PRESETS } from './presets'
import { applyStyleDirective, checkLayer, directivesFor, isClean, resolveFigureSettings, resolveStyle, type StyleLayer } from './resolve'

const layerOf = (lines: string[]): StyleLayer => {
  const layer: StyleLayer = {}
  for (const line of lines) {
    const [name, value] = line.split(':').map((s) => s.trim())
    applyStyleDirective(layer, name, value)
  }
  return layer
}

describe('resolving a style', () => {
  it('is clean with no layers at all', () => {
    expect(resolveStyle([])).toEqual({ ...PRESETS.clean, seed: 0 })
    expect(isClean(resolveStyle([]))).toBe(true)
  })

  it('layers default, then base, then the figure, each overriding only what it sets', () => {
    const base: StyleLayer = { line: { looseness: 0.5 }, paper: { type: 'graph' } }
    const figure: StyleLayer = { line: { looseness: 0.1 } }
    const style = resolveStyle([base, figure])
    // The figure wins where both speak...
    expect(style.line.looseness).toBe(0.1)
    // ...the base stands where only it speaks...
    expect(style.paper.type).toBe('graph')
    // ...and clean fills in everything else.
    expect(style.line.type).toBe('technical')
    expect(style.fill).toEqual(PRESETS.clean.fill)
  })

  it('starts a layer from its preset, then applies that layer’s own settings', () => {
    const style = resolveStyle([layerOf(['style-paper: graph', 'style: pencil'])])
    expect(style.paper.type).toBe('graph')
    expect(style.line).toEqual(PRESETS.pencil.line)
    expect(style.lettering).toEqual(PRESETS.pencil.lettering)
  })

  it('lets a figure preset replace the base entirely, but not the seed', () => {
    const style = resolveStyle([{ preset: 'marker', line: { looseness: 0.9 }, seed: 4 }, { preset: 'ink' }])
    expect(style.line).toEqual(PRESETS.ink.line)
    expect(style.seed).toBe(4)
  })

  it('is clean again when a figure states clean over a styled base', () => {
    expect(isClean(resolveStyle([{ preset: 'pencil' }, { preset: 'clean' }]))).toBe(true)
    expect(isClean(resolveStyle([{ preset: 'clean', seed: 9 }]))).toBe(true)
    expect(isClean(resolveStyle([{ preset: 'clean', line: { looseness: 0.1 } }]))).toBe(false)
  })

  it('reads every spelling of a setting', () => {
    const style = resolveStyle([
      layerOf([
        'style-line: brush',
        'style-looseness: 0.4',
        'style-fill: crosshatch',
        'style-paper: rough-graph',
        'style-lettering: hand',
        'style-saturation: 0.6',
        'style-seed: 3',
        'style-line-width: 1.5',
        'style-fill-angle: 30',
        'style-tint: f5f0e6',
        'style-ink: #1d2a4a',
        'style-lettering-size: 1.2',
        'style-medium: graphite',
      ]),
    ])
    expect(style.line).toMatchObject({ type: 'brush', looseness: 0.4, width: 1.5 })
    expect(style.fill).toMatchObject({ type: 'crosshatch', angle: 30 })
    expect(style.paper).toMatchObject({ type: 'rough-graph', tint: '#f5f0e6' })
    expect(style.lettering).toMatchObject({ face: 'hand', size: 1.2 })
    expect(style.colour).toEqual({ ink: '#1d2a4a', saturation: 0.6, medium: 'graphite' })
    expect(style.seed).toBe(3)
  })

  it('resolves for the graph type it is told: a flat figure by default, a solid one as figure3d', () => {
    const theme = { byType: { figure3d: { set: { 'style.line.looseness': 0.9 } } } }
    expect(resolveStyle([], theme).line.looseness).toBe(0)
    expect(resolveStyle([], theme, 'figure2d').line.looseness).toBe(0)
    expect(resolveStyle([], theme, 'figure3d').line.looseness).toBe(0.9)
    // The figure's own setting still wins over the theme's, for either type.
    expect(resolveStyle([{ line: { looseness: 0.2 } }], theme, 'figure3d').line.looseness).toBe(0.2)
    expect(resolveFigureSettings([], theme, 'figure3d').get('style.line.looseness')).toBe(0.9)
  })

  it('reads the medium by every spelling, and a style in any medium but clean is not clean', () => {
    for (const name of ['style-medium', 'style-colour-medium', 'style-color-medium']) {
      expect(resolveStyle([layerOf([`${name}: chalk`])]).colour.medium, name).toBe('chalk')
    }
    expect(resolveStyle([]).colour.medium).toBe('clean')
    expect(isClean(resolveStyle([layerOf(['style-medium: marker'])]))).toBe(false)
    expect(isClean(resolveStyle([layerOf(['style-medium: clean'])]))).toBe(true)
  })

  it('reads every preset by its name, the old ones and the new, and the old paper names', () => {
    for (const name of PRESET_NAMES) expect(resolveStyle([layerOf([`style: ${name}`])]), name).toEqual({ ...PRESETS[name], seed: 0 })
    for (const paper of ['paper', 'rough-paper', 'canvas', 'graph', 'rough-graph', 'dotted', 'ruled', 'none', 'clean']) {
      expect(resolveStyle([layerOf([`style-paper: ${paper}`])]).paper.type, paper).toBe(paper)
    }
    const parsed = parseSpec(['@style: blackboard', '@style-paper: graph', 'A = (0, 0)'].join('\n'))
    expect(parsed.errors).toEqual([])
    expect(resolveStyle([parsed.config.style]).colour.medium).toBe('chalk')
    expect(resolveStyle([parsed.config.style]).paper.type).toBe('graph')
  })

  it('writes a medium back as a directive', () => {
    const style = resolveStyle([{ preset: 'blackboard', colour: { medium: 'whiteboard' } }])
    const lines = directivesFor(style)
    expect(lines).toContain('@style-medium: whiteboard')
    const again = resolveStyle([layerOf(lines.map((l) => l.slice(1)))])
    expect(again).toEqual(style)
  })

  it('writes a style back as the directives that reproduce it', () => {
    const style = resolveStyle([{ preset: 'pencil', paper: { type: 'graph' }, line: { looseness: 0.45 }, seed: 2 }])
    const lines = directivesFor(style)
    expect(lines[0]).toBe('@style: pencil')
    expect(lines).toContain('@style-paper: graph')
    expect(lines).toContain('@style-looseness: 0.45')
    expect(lines).toContain('@style-seed: 2')
    // Only what differs from the preset.
    expect(lines).toHaveLength(4)
    const again = resolveStyle([layerOf(lines.slice(1).map((l) => l.slice(1)).concat(['style: pencil']))])
    expect(again).toEqual(style)
  })
})

describe('refusing a bad directive', () => {
  it('names the valid presets, the new looks too', () => {
    expect(() => applyStyleDirective({}, 'style', 'crayon')).toThrow(/clean, ink, pencil, marker/)
    expect(() => applyStyleDirective({}, 'style', 'crayon')).toThrow(/colouredPencil, blackboard, greenboard, whiteboard/)
    const { errors } = checkLayer({ preset: 'crayon' } as never)
    expect(errors.join('\n')).toMatch(/blackboard/)
  })

  it('names the valid media', () => {
    expect(() => applyStyleDirective({}, 'style-medium', 'oil')).toThrow(/clean, ink, graphite, colouredPencil, marker, chalk, whiteboard/)
  })

  it('names the valid settings', () => {
    expect(() => applyStyleDirective({}, 'style-sparkle', '1')).toThrow(/looseness/)
    expect(() => applyStyleDirective({}, 'style-sparkle', '1')).toThrow(/"@style-sparkle"/)
  })

  it('names the valid values of a choice', () => {
    expect(() => applyStyleDirective({}, 'style-line', 'crayon')).toThrow(/technical, ink, brush, pencil, marker, chalk/)
    expect(() => applyStyleDirective({}, 'style-fill', 'dots')).toThrow(/flat, hatch, crosshatch, stipple, scribble, wash, none/)
    expect(() => applyStyleDirective({}, 'style-paper', 'papyrus')).toThrow(/rough-paper/)
    expect(() => applyStyleDirective({}, 'style-lettering', 'gothic')).toThrow(/math, textbook, hand/)
  })

  it('names the range of a number', () => {
    expect(() => applyStyleDirective({}, 'style-looseness', '3')).toThrow(/0 to 1/)
    expect(() => applyStyleDirective({}, 'style-saturation', 'lots')).toThrow(/0 to 1\.5/)
    expect(() => applyStyleDirective({}, 'style-passes', '2.5')).toThrow(/whole number/)
  })

  it('reads the shared colour names in colour settings', () => {
    const style = resolveStyle([layerOf(['style-ink: blue', 'style-tint: Teal'])])
    expect(style.colour.ink).toBe('#2f5fd0')
    expect(style.paper.tint).toBe('#1f9a92')
    expect(() => applyStyleDirective({}, 'style-ink', 'navy')).toThrow(/red, orange, yellow/)
  })

  it('refuses the names every object inherits, and three-digit hex, like any unknown colour', () => {
    for (const value of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'fed']) {
      expect(() => applyStyleDirective({}, 'style-ink', value), value).toThrow(/must be a colour/)
      expect(() => applyStyleDirective({}, 'style-tint', value), value).toThrow(/must be a colour/)
    }
    expect(resolveStyle([layerOf(['style-tint: ffeedd'])]).paper.tint).toBe('#ffeedd')
  })

  it('explains a colour, and the "#" that starts a comment', () => {
    expect(() => applyStyleDirective({}, 'style-tint', '')).toThrow(/without the "#"/)
  })

  it('ignores the bad directive and keeps the rest, through parseSpec', () => {
    const parsed = parseSpec(['@style: pencil', '@style-line: crayon', '@style-paper: graph', 'A = (0, 0)'].join('\n'))
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0].line).toBe(2)
    expect(parsed.errors[0].message).toMatch(/technical, ink, brush, pencil, marker, chalk/)
    const style = resolveStyle([parsed.config.style])
    expect(style.line.type).toBe('pencil')
    expect(style.paper.type).toBe('graph')
  })

  it('leaves a spec with no style directive with an empty figure layer', () => {
    expect(parseSpec('A = (0, 0)').config.style).toEqual({})
  })
})

describe('checking a base style from the host', () => {
  it('keeps what is valid and names what is not', () => {
    const { layer, errors } = checkLayer({ preset: 'ink', line: { looseness: 7, type: 'crayon', wobble: 0.2 }, paper: { tint: 'nope' } } as never)
    expect(layer).toEqual({ preset: 'ink', line: { wobble: 0.2 } })
    expect(errors).toHaveLength(3)
    expect(errors.join('\n')).toMatch(/looseness/)
    expect(errors.join('\n')).toMatch(/technical, ink, brush/)
  })

  it('refuses a base style that is not an object in one legible sentence', () => {
    for (const bad of ['ink', ['ink'], null, 3]) {
      const { layer, errors } = checkLayer(bad as never)
      expect(layer).toEqual({})
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatch(/must be an object such as \{ preset: 'ink'/)
    }
  })

  it('refuses an unknown preset and an unknown group', () => {
    const { layer, errors } = checkLayer({ preset: 'crayon', glitter: {} } as never)
    expect(layer).toEqual({})
    expect(errors).toHaveLength(2)
  })
})
