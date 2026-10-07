import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { renderFigure } from '../figure/render'
import { LIGHT_PALETTE } from '../render/palette'
import {
  BUILTIN_THEME_STYLES,
  collapseLayers,
  layerFromStyleLayer,
  mediumSettingsOf,
  resolveSettings,
  toPaintParams,
  toStyle,
  TYPE_DEFAULTS,
  type SettingsLayer,
  type StyleStack,
} from './layers'
import { MEDIA } from './media'
import { PRESET_NAMES, PRESETS } from './presets'
import { applyStyleDirective, applyStyleSet, checkLayer, checkSettingsLayer, checkThemeStyles, isClean, resolveStyle, themeStylesOf, type StyleLayer } from './resolve'
import { REGISTRY, settingAt } from './settings/registry'
import { findSetting, nearestPaths } from './settings/values'
import { fromOsmosisTheme, resolveTheme, stylesForPreset, stylesFromTable } from './theme/adapter'
import { BUILTIN_THEME_IDS } from './theme/defaults'
import { GRAPH_TYPES, MEDIUM_NAMES } from './theme/types'

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

const LOOSE = 'style.line.looseness'
const SOFT = 'paint.value.terminatorSoftness'
const CHROMA = 'media.chalk.chroma'

// A layer that sets one setting.
const only = (path: string, value: number): SettingsLayer => ({ set: { [path]: value } })

// The six layers, each setting `path` to its own value (the n-th of `values`, bottom to top).
function sixLayers(path: string, values: number[]): StyleStack {
  return {
    typeDefaults: { space: only(path, values[0]) },
    theme: { all: only(path, values[1]), byType: { space: only(path, values[2]) } },
    document: only(path, values[3]),
    figure: only(path, values[4]),
  }
}

describe('the six-layer stack: the most specific layer wins', () => {
  // One path from each engine: the stack is one stack for the figure styles, the painter and the media.
  const CASES: [string, number, number[]][] = [
    [LOOSE, 0, [0.1, 0.2, 0.3, 0.4, 0.5]],
    [SOFT, 0.1, [0.2, 0.3, 0.4, 0.5, 0.6]],
    [CHROMA, 0.6, [0.52, 0.55, 0.58, 0.62, 0.66]],
  ]

  for (const [path, base, values] of CASES) {
    describe(path, () => {
      const at = (stack: StyleStack, type: (typeof GRAPH_TYPES)[number] = 'space') => resolveSettings(stack, type).get(path)
      const [typeDefault, themeAll, themeType, document, figure] = values

      it('is the registry default when no layer says anything', () => {
        expect(at({})).toBe(base)
        expect(settingAt(path)!.default).toBe(base)
      })

      it('takes the graph type’s default over the registry default (1 < 2)', () => {
        expect(at({ typeDefaults: { space: only(path, typeDefault) } })).toBe(typeDefault)
      })

      it('takes the theme’s setting over the graph type’s default (2 < 3), Ben’s ruling', () => {
        const stack: StyleStack = { typeDefaults: { space: only(path, typeDefault) }, theme: { all: only(path, themeAll) } }
        expect(at(stack)).toBe(themeAll)
        // The order the layers are written in the stack object does not matter.
        const swapped: StyleStack = { theme: { all: only(path, themeAll) }, typeDefaults: { space: only(path, typeDefault) } }
        expect(at(swapped)).toBe(themeAll)
      })

      it('takes the theme’s setting for this graph type over the theme’s for all (3 < 4)', () => {
        expect(at({ theme: { all: only(path, themeAll), byType: { space: only(path, themeType) } } })).toBe(themeType)
      })

      it('takes the theme’s setting for this graph type over the graph type’s default (2 < 4)', () => {
        expect(at({ typeDefaults: { space: only(path, typeDefault) }, theme: { byType: { space: only(path, themeType) } } })).toBe(themeType)
      })

      it('takes the document over the theme for this graph type (4 < 5)', () => {
        expect(at({ theme: { byType: { space: only(path, themeType) } }, document: only(path, document) })).toBe(document)
      })

      it('takes the figure over the document (5 < 6)', () => {
        expect(at({ document: only(path, document), figure: only(path, figure) })).toBe(figure)
      })

      it('takes the figure over every other layer when all six set it', () => {
        expect(at(sixLayers(path, values))).toBe(figure)
      })

      it('falls to the next layer down as the higher ones go, one at a time', () => {
        const full = sixLayers(path, values)
        expect(at({ ...full, figure: undefined })).toBe(document)
        expect(at({ ...full, figure: undefined, document: undefined })).toBe(themeType)
        expect(at({ ...full, figure: undefined, document: undefined, theme: { all: full.theme!.all } })).toBe(themeAll)
        expect(at({ ...full, figure: undefined, document: undefined, theme: undefined })).toBe(typeDefault)
        expect(at({ ...full, figure: undefined, document: undefined, theme: undefined, typeDefaults: undefined })).toBe(base)
      })

      it('ignores the layers of other graph types', () => {
        const stack = sixLayers(path, values)
        expect(at({ typeDefaults: stack.typeDefaults, theme: stack.theme }, 'figure2d')).toBe(themeAll)
        expect(at({ typeDefaults: stack.typeDefaults }, 'figure2d')).toBe(base)
        expect(at({ theme: { byType: { space: only(path, themeType) } } }, 'graph2d')).toBe(base)
      })
    })
  }

  it('shows a lower layer’s setting through wherever a higher layer does not set it', () => {
    const stack: StyleStack = {
      typeDefaults: { space: only('style.line.wobble', 0.11) },
      theme: { all: only('style.line.taper', 0.22), byType: { space: only('style.line.grain', 0.33) } },
      document: only('style.line.variation', 0.44),
      figure: only('style.line.opacity', 0.55),
    }
    const line = toStyle(resolveSettings(stack, 'space')).line
    expect(line).toMatchObject({ wobble: 0.11, taper: 0.22, grain: 0.33, variation: 0.44, opacity: 0.55 })
    expect(line.looseness).toBe(0)
    expect(line.type).toBe('technical')
  })

  it('has a value for every registry path, the registry’s own for an empty stack', () => {
    const resolved = resolveSettings({}, 'space')
    expect(resolved.size).toBe(REGISTRY.length)
    for (const spec of REGISTRY) expect(resolved.get(spec.path), spec.path).toEqual(spec.default)
  })

  it('has no built-in graph type defaults to start', () => {
    expect(Object.keys(TYPE_DEFAULTS)).toEqual([])
    for (const type of GRAPH_TYPES) expect(resolveSettings({ typeDefaults: TYPE_DEFAULTS }, type)).toEqual(resolveSettings({}, type))
  })

  it('skips a path that is not a setting', () => {
    // (JSON, so that "__proto__" is a key of the object, as it is in a stored theme.)
    const document = JSON.parse('{"set":{"nope.nothing":1,"__proto__":2,"constructor":3,"style.line":4}}') as SettingsLayer
    const resolved = resolveSettings({ document }, 'space')
    expect(resolved.size).toBe(REGISTRY.length)
    for (const path of ['nope.nothing', '__proto__', 'constructor', 'style.line']) expect(resolved.has(path), path).toBe(false)
  })
})

describe('a preset in a layer', () => {
  const PENCIL = PRESETS.pencil

  // What the layers below set: a figure look, the painter and a medium.
  const below: SettingsLayer = {
    set: { [LOOSE]: 0.9, 'style.paper.type': 'graph', 'style.fill.type': 'scribble', 'style.seed': 7, [SOFT]: 0.9, [CHROMA]: 0.7, 'board.tilt': 0.9 },
  }

  it('replaces every style.* setting below it with the preset’s look', () => {
    const style = toStyle(resolveSettings({ theme: { all: below }, document: { preset: 'pencil' } }, 'figure2d'))
    expect(style.line).toEqual(PENCIL.line)
    expect(style.fill).toEqual(PENCIL.fill)
    expect(style.paper).toEqual(PENCIL.paper)
    expect(style.lettering).toEqual(PENCIL.lettering)
    expect(style.colour).toEqual(PENCIL.colour)
  })

  it('leaves paint.*, media.* and board.* alone', () => {
    const resolved = resolveSettings({ theme: { all: below }, document: { preset: 'pencil' } }, 'space')
    expect(resolved.get(SOFT)).toBe(0.9)
    expect(resolved.get(CHROMA)).toBe(0.7)
    expect(resolved.get('board.tilt')).toBe(0.9)
    // Every setting that is not a figure style is what the stack without the preset has.
    const without = resolveSettings({ theme: { all: below } }, 'space')
    for (const spec of REGISTRY) if (!spec.path.startsWith('style.')) expect(resolved.get(spec.path), spec.path).toEqual(without.get(spec.path))
  })

  it('leaves the seed alone: choosing a preset never rerolls', () => {
    expect(toStyle(resolveSettings({ theme: { all: below }, document: { preset: 'pencil' } }, 'figure2d')).seed).toBe(7)
    expect(resolveSettings({ document: { preset: 'marker' } }, 'figure2d').get('style.seed')).toBe(0)
  })

  it('then applies the layer’s own settings, whatever order they were written in', () => {
    const style = toStyle(resolveSettings({ document: { set: { [LOOSE]: 0.45 }, preset: 'pencil' } }, 'figure2d'))
    expect(style.line).toEqual({ ...PENCIL.line, looseness: 0.45 })
    expect(style.paper).toEqual(PENCIL.paper)
  })

  it('does not undo a setting of a layer above it', () => {
    const style = toStyle(resolveSettings({ typeDefaults: { figure2d: { preset: 'ink' } }, theme: { all: only(LOOSE, 0.05) } }, 'figure2d'))
    expect(style.line).toEqual({ ...PRESETS.ink.line, looseness: 0.05 })
    expect(style.paper).toEqual(PRESETS.ink.paper)
  })

  it('works in the theme’s per-type layer, over what the theme says for all types', () => {
    const style = toStyle(resolveSettings({ theme: { all: only(LOOSE, 0.9), byType: { figure2d: { preset: 'marker' } } } }, 'figure2d'))
    expect(style.line).toEqual(PRESETS.marker.line)
    // Another graph type does not see it.
    expect(toStyle(resolveSettings({ theme: { all: only(LOOSE, 0.9), byType: { figure2d: { preset: 'marker' } } } }, 'space')).line.looseness).toBe(0.9)
  })

  it('goes back to clean when the figure says clean over a styled document', () => {
    const style = toStyle(resolveSettings({ document: { preset: 'pencil', set: { [LOOSE]: 0.4 } }, figure: { preset: 'clean' } }, 'figure2d'))
    expect({ ...style, seed: undefined }).toEqual({ ...PRESETS.clean, seed: undefined })
    expect(isClean(style)).toBe(true)
  })

  it('is every named preset exactly', () => {
    for (const name of PRESET_NAMES) expect(toStyle(resolveSettings({ figure: { preset: name } }, 'figure2d')), name).toEqual({ ...PRESETS[name], seed: 0 })
  })

  it('ignores a preset that is not one', () => {
    expect(resolveSettings({ document: { preset: 'crayon' } }, 'figure2d')).toEqual(resolveSettings({}, 'figure2d'))
  })
})

// ---------------------------------------------------------------------------
// What the stack hands each engine
// ---------------------------------------------------------------------------

describe('toStyle', () => {
  it('is clean, seed 0, for an empty stack, with its keys in the order resolveStyle always gave them', () => {
    const style = toStyle(resolveSettings({}, 'figure2d'))
    expect(style).toEqual({ ...PRESETS.clean, seed: 0 })
    expect(JSON.stringify(style)).toBe(JSON.stringify({ ...PRESETS.clean, seed: 0 }))
  })

  it('is a new object each time', () => {
    const a = toStyle(resolveSettings({}, 'figure2d'))
    a.line.looseness = 0.8
    expect(toStyle(resolveSettings({}, 'figure2d')).line.looseness).toBe(0)
    expect(PRESETS.clean.line.looseness).toBe(0)
  })
})

describe('mediumSettingsOf', () => {
  it('is each medium’s defaults for an empty stack', () => {
    const resolved = resolveSettings({}, 'figure2d')
    for (const name of MEDIUM_NAMES) {
      const expected = Object.fromEntries(MEDIA[name].settings.map((setting) => [setting.key, setting.default]))
      expect(mediumSettingsOf(resolved, name), name).toEqual(expected)
    }
  })

  it('carries a medium setting the stack changed, and only that medium’s', () => {
    const resolved = resolveSettings({ theme: { all: only(CHROMA, 0.7) } }, 'figure2d')
    expect(mediumSettingsOf(resolved, 'chalk').chroma).toBe(0.7)
    for (const name of MEDIUM_NAMES) {
      if (name === 'chalk') continue
      expect(mediumSettingsOf(resolved, name), name).toEqual(mediumSettingsOf(resolveSettings({}, 'figure2d'), name))
    }
  })
})

describe('layerFromStyleLayer', () => {
  it('writes each group setting and the seed by registry path, and keeps the preset and the set', () => {
    const layer: StyleLayer = {
      preset: 'ink',
      line: { looseness: 0.4, type: 'brush' },
      colour: { saturation: 0.5 },
      seed: 3,
      set: { [SOFT]: 0.3 },
    }
    expect(layerFromStyleLayer(layer)).toEqual({
      preset: 'ink',
      set: { 'style.line.looseness': 0.4, 'style.line.type': 'brush', 'style.colour.saturation': 0.5, 'style.seed': 3, [SOFT]: 0.3 },
    })
    expect(layerFromStyleLayer({})).toEqual({ set: {} })
  })
})

describe('the built-in themes’ style sets', () => {
  it('are one for each built-in theme, empty to start, and each a valid set', () => {
    expect(Object.keys(BUILTIN_THEME_STYLES).sort()).toEqual([...BUILTIN_THEME_IDS].sort())
    for (const [id, styles] of Object.entries(BUILTIN_THEME_STYLES)) {
      const checked = checkThemeStyles(styles)
      expect(checked.errors, id).toEqual([])
      // Whatever Ben tunes into a set must survive the check unchanged.
      expect(checked.styles, id).toEqual(styles)
    }
  })

  it('are frozen, the table and each set in it: nothing at run time changes a built-in theme', () => {
    expect(Object.isFrozen(BUILTIN_THEME_STYLES)).toBe(true)
    for (const [id, styles] of Object.entries(BUILTIN_THEME_STYLES)) expect(Object.isFrozen(styles), id).toBe(true)
    expect(() => {
      ;(BUILTIN_THEME_STYLES as Record<string, unknown>)['builtin:slate'] = { all: {} }
    }).toThrow(TypeError)
    expect(() => {
      ;(BUILTIN_THEME_STYLES as Record<string, unknown>)['builtin:test-added'] = { all: {} }
    }).toThrow(TypeError)
    expect(() => {
      ;(BUILTIN_THEME_STYLES['builtin:slate'] as Record<string, unknown>).all = { set: {} }
    }).toThrow(TypeError)
    expect(BUILTIN_THEME_STYLES['builtin:test-added']).toBeUndefined()
    expect(BUILTIN_THEME_STYLES['builtin:slate']).toEqual({})
  })

  it('come with the theme: an empty set says nothing', () => {
    for (const id of BUILTIN_THEME_IDS) {
      expect(stylesForPreset(id), id).toBeUndefined()
      expect(fromOsmosisTheme(LIGHT_PALETTE, 'light', { id }).styles, id).toBeUndefined()
    }
    expect(stylesForPreset('custom:mine')).toBeUndefined()
    expect(stylesForPreset('constructor')).toBeUndefined()
    expect(stylesForPreset('__proto__')).toBeUndefined()
  })

  it('come with the theme: a set with something in it is the theme’s styles, supplied through the adapter’s own hook', () => {
    const tuned = { all: { set: { [LOOSE]: 0.2 } } }
    // A table of the test's own, through the table reader the built-in ones use...
    const fromTable = stylesFromTable({ 'builtin:test-tuned': tuned, 'builtin:test-empty': {}, 'builtin:test-null': null })
    expect(fromTable('builtin:test-tuned')).toBe(tuned)
    expect(fromTable('builtin:test-empty')).toBeUndefined()
    expect(fromTable('builtin:test-null')).toBeNull()
    expect(fromTable('builtin:test-missing')).toBeUndefined()
    expect(fromTable('constructor')).toBeUndefined()
    // ...or through a StylesFor of its own.
    for (const stylesFor of [fromTable, (id: string) => (id === 'builtin:test-tuned' ? tuned : undefined)]) {
      const theme = fromOsmosisTheme(LIGHT_PALETTE, 'light', { id: 'builtin:test-tuned' }, stylesFor)
      expect(theme.styles).toEqual(tuned)
      expect(themeStylesOf(theme)).toEqual(tuned)
      expect(resolveSettings({ theme: themeStylesOf(theme) }, 'space').get(LOOSE)).toBe(0.2)
    }
    // The built-in table is as it was.
    expect(fromOsmosisTheme(LIGHT_PALETTE, 'light', { id: 'builtin:test-tuned' }).styles).toBeUndefined()
  })
})

describe('a theme’s style set, through the stack', () => {
  const theme = resolveTheme({
    styles: {
      all: { set: { [LOOSE]: 0.2, [SOFT]: 0.3 } },
      byType: { space: { set: { [SOFT]: 0.6 } }, figure2d: { preset: 'ink' } },
    },
  })

  it('is read from ThemeInput.styles, for each graph type', () => {
    const styles = themeStylesOf(theme)!
    expect(resolveSettings({ theme: styles }, 'graph2d').get(LOOSE)).toBe(0.2)
    expect(resolveSettings({ theme: styles }, 'space').get(SOFT)).toBe(0.6)
    expect(resolveSettings({ theme: styles }, 'graph2d').get(SOFT)).toBe(0.3)
    expect(toStyle(resolveSettings({ theme: styles }, 'figure2d')).line).toEqual(PRESETS.ink.line)
  })

  it('beats the graph type’s default, and loses to the document', () => {
    const styles = themeStylesOf(theme)!
    const typeDefaults = { space: only(SOFT, 0.9) }
    expect(resolveSettings({ typeDefaults, theme: styles }, 'space').get(SOFT)).toBe(0.6)
    expect(resolveSettings({ typeDefaults, theme: styles, document: only(SOFT, 0.45) }, 'space').get(SOFT)).toBe(0.45)
  })

  it('is nothing for a theme with no styles', () => {
    expect(themeStylesOf(resolveTheme({}))).toBeUndefined()
    expect(themeStylesOf({ styles: null })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveStyle is the stack
// ---------------------------------------------------------------------------

// resolveStyle as it was before the stack: the figure styles' five groups, folded layer by layer.
function previousResolveStyle(layers: readonly (StyleLayer | null | undefined)[]) {
  const clone = (look: (typeof PRESETS)['clean']) => ({
    line: { ...look.line },
    fill: { ...look.fill },
    paper: { ...look.paper },
    lettering: { ...look.lettering },
    colour: { ...look.colour },
  })
  let look = clone(PRESETS.clean)
  let seed = 0
  for (const layer of layers) {
    if (!layer) continue
    if (layer.preset) look = clone(PRESETS[layer.preset])
    for (const group of ['line', 'fill', 'paper', 'lettering', 'colour'] as const) Object.assign(look[group], layer[group] ?? {})
    if (layer.seed !== undefined) seed = layer.seed
  }
  return { ...look, seed }
}

describe('resolveStyle on the stack', () => {
  const LAYERS: (StyleLayer | null | undefined)[] = [
    undefined,
    null,
    {},
    { preset: 'pencil' },
    { preset: 'ink' },
    { preset: 'marker', line: { looseness: 0.9 }, seed: 4 },
    { preset: 'clean', seed: 9 },
    { preset: 'clean', line: { looseness: 0.1 } },
    { line: { looseness: 0.5 }, paper: { type: 'graph' } },
    { line: { looseness: 0.1, type: 'brush', passes: 2 }, fill: { type: 'crosshatch', angle: 30 } },
    { paper: { tint: '#f5f0e6', grid: 40 }, lettering: { face: 'hand', size: 1.2 }, colour: { ink: '#1d2a4a', saturation: 0.6 } },
    { seed: 3 },
  ]

  it('gives exactly what it always gave, for every list of one, two and three layers it was tested with', () => {
    const same = (layers: (StyleLayer | null | undefined)[]) => {
      const now = resolveStyle(layers)
      const before = previousResolveStyle(layers)
      expect(now, JSON.stringify(layers)).toEqual(before)
      expect(JSON.stringify(now), JSON.stringify(layers)).toBe(JSON.stringify(before))
    }
    same([])
    for (const a of LAYERS) {
      same([a])
      for (const b of LAYERS) same([a, b])
    }
    for (const a of LAYERS.slice(2, 8)) for (const b of LAYERS.slice(2, 8)) for (const c of LAYERS.slice(4, 10)) same([a, b, c])
  })

  it('is the stack with the base as the document and the figure as the figure', () => {
    for (const base of LAYERS) {
      for (const figure of LAYERS) {
        const stack: StyleStack = {
          document: base ? layerFromStyleLayer(base) : undefined,
          figure: figure ? layerFromStyleLayer(figure) : undefined,
        }
        expect(resolveStyle([base, figure]), JSON.stringify([base, figure])).toEqual(toStyle(resolveSettings(stack, 'figure2d')))
      }
    }
  })

  it('goes through the stack for figure2d: the last layer is the figure, the ones before it the document', () => {
    const LIST: StyleLayer[] = [
      { preset: 'pencil', line: { looseness: 0.5 }, seed: 3, set: { [SOFT]: 0.3 } },
      { preset: 'ink', paper: { type: 'graph' } },
      { line: { wobble: 0.2 }, set: { [SOFT]: 0.6 } },
    ]
    for (const n of [0, 1, 2, 3]) {
      const layers = LIST.slice(0, n)
      const settings = layers.map(layerFromStyleLayer)
      const figure = settings.pop()
      expect(resolveStyle(layers), String(n)).toEqual(toStyle(resolveSettings({ document: collapseLayers(settings), figure }, 'figure2d')))
    }
  })

  it('does not change what it is given', () => {
    const base: StyleLayer = { preset: 'pencil', line: { looseness: 0.5 }, set: { [SOFT]: 0.3 } }
    const figure: StyleLayer = { line: { looseness: 0.1 }, set: { 'paint.curves.value': [[0, 0], [1, 1]] } }
    const snapshot = JSON.stringify([base, figure])
    resolveStyle([base, figure])
    expect(JSON.stringify([base, figure])).toBe(snapshot)
  })

  it('is untouched by a setting that is not a figure style', () => {
    expect(resolveStyle([{ set: { [SOFT]: 0.3, [CHROMA]: 0.7 } }])).toEqual(resolveStyle([]))
    expect(isClean(resolveStyle([{ set: { [SOFT]: 0.3 } }]))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// @style-set
// ---------------------------------------------------------------------------

const FIGURE = '@mode: figure\nA = (-2, -2)\nB = (2, -2)\nC = (2, 2)\nD = (-2, 2)\nfill: square ABCD'
const draw = (spec: string) => {
  const parsed = parseSpec(spec)
  return { parsed, drawn: renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE) }
}
const messageOf = (run: () => void): string => {
  try {
    run()
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected a refusal')
}
const setMessage = (text: string) => messageOf(() => applyStyleSet({}, text))

describe('@style-set', () => {
  it('writes a figure style where its own directive writes it, so the last one written wins', () => {
    const layer: StyleLayer = {}
    applyStyleDirective(layer, 'style-looseness', '0.2')
    applyStyleSet(layer, 'style.line.looseness 0.4')
    expect(layer).toEqual({ line: { looseness: 0.4 } })
    applyStyleDirective(layer, 'style-looseness', '0.7')
    expect(layer).toEqual({ line: { looseness: 0.7 } })
    expect(layer.set).toBeUndefined()
  })

  it('writes any other setting under `set`, by its registry path', () => {
    const layer: StyleLayer = {}
    applyStyleSet(layer, 'paint.value.terminatorSoftness 0.4')
    applyStyleSet(layer, 'media.chalk.chroma 0.55')
    applyStyleSet(layer, 'paint.canvas.weave duck')
    expect(layer).toEqual({ set: { [SOFT]: 0.4, [CHROMA]: 0.55, 'paint.canvas.weave': 'duck' } })
  })

  it('may leave "style." off a figure style, as the design writes it', () => {
    const layer: StyleLayer = {}
    applyStyleSet(layer, 'line.looseness 0.4')
    applyStyleSet(layer, 'paper.tint teal')
    applyStyleSet(layer, 'seed 5')
    expect(layer).toEqual({ line: { looseness: 0.4 }, paper: { tint: '#1f9a92' }, seed: 5 })
    expect(findSetting('line.looseness')).toBe(settingAt(LOOSE))
    expect(findSetting('looseness')).toBeUndefined()
  })

  it('reads a curve as JSON or as x,y pairs', () => {
    const a: StyleLayer = {}
    const b: StyleLayer = {}
    applyStyleSet(a, 'paint.curves.value [[0,0],[0.5,0.7],[1,1]]')
    applyStyleSet(b, 'paint.curves.value 0,0 0.5,0.7 1,1')
    expect(a.set!['paint.curves.value']).toEqual([[0, 0], [0.5, 0.7], [1, 1]])
    expect(b).toEqual(a)
  })

  it('round-trips through the parser and the stack into the painter’s parameters', () => {
    const spec = [FIGURE, '@style-set: paint.value.terminatorSoftness 0.4', '@style-set: paint.canvas.weave duck', '@style-set: paint.curves.value 0,0 0.5,0.7 1,1'].join('\n')
    const { parsed, drawn } = draw(spec)
    expect(parsed.errors).toEqual([])
    expect(drawn.errors).toEqual([])
    const resolved = resolveSettings({ figure: layerFromStyleLayer(parsed.config.style) }, 'space')
    expect(resolved.get(SOFT)).toBe(0.4)
    const params = toPaintParams(resolved)
    expect(params.value.terminatorSoftness).toBe(0.4)
    expect(params.canvas.weave).toBe('duck')
    expect(params.curves.value).toEqual([[0, 0], [0.5, 0.7], [1, 1]])
  })

  it('round-trips a figure style through the parser into the figure', () => {
    const base = ['@style: pencil', FIGURE]
    const viaSet = draw([...base, '@style-set: style.line.looseness 0.45'].join('\n'))
    const viaDirective = draw([...base, '@style-looseness: 0.45'].join('\n'))
    expect(viaSet.parsed.errors).toEqual([])
    expect(viaSet.drawn.svg).toBe(viaDirective.drawn.svg)
    expect(viaSet.drawn.svg).not.toBe(draw(base.join('\n')).drawn.svg)
    expect(viaSet.parsed.config.style.line!.looseness).toBe(0.45)
  })

  it('wins over the host’s base style, which sits below the figure', () => {
    const parsed = parseSpec([FIGURE, '@style-set: style.line.looseness 0.45'].join('\n'))
    const withBase = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, { preset: 'pencil', line: { looseness: 0.9 } })
    const figureOnly = renderFigure(parsed.statements, { ...parsed.config, style: { preset: 'pencil', line: { looseness: 0.45 } } }, LIGHT_PALETTE)
    expect(withBase.svg).toBe(figureOnly.svg)
  })

  it('leaves a figure that sets only paint or media settings clean, byte for byte', () => {
    const plain = draw(FIGURE).drawn
    const set = draw([FIGURE, '@style-set: paint.value.terminatorSoftness 0.4', '@style-set: media.chalk.chroma 0.55'].join('\n'))
    expect(set.parsed.errors).toEqual([])
    expect(set.drawn.svg).toBe(plain.svg)
  })

  describe('refuses an unknown path, naming the nearest', () => {
    it('for a misspelt setting', () => {
      const message = setMessage('style.line.loosenes 0.4')
      expect(message).toMatch(/^@style-set has no setting "style\.line\.loosenes"/)
      expect(message).toMatch(/nearest are style\.line\.looseness/)
      expect(setMessage('paint.value.terminatorSoftnes 0.4')).toMatch(/nearest are paint\.value\.terminatorSoftness/)
      expect(setMessage('media.chalk.croma 0.6')).toMatch(/nearest are media\.chalk\.chroma/)
    })

    it('for a bare name or a figure style under the wrong group', () => {
      expect(setMessage('looseness 0.4')).toMatch(/nearest are style\.line\.looseness/)
      expect(setMessage('fill.looseness 0.4')).toMatch(/style\.line\.looseness/)
    })

    it('for a group of settings, naming what is in it', () => {
      const message = setMessage('paint.value 0.4')
      expect(message).toMatch(/"paint\.value" is a group of settings, not one setting/)
      expect(message).toMatch(/it holds paint\.value\.\w+/)
    })

    it('lists no more than three near paths, nearest first, the same every time', () => {
      const near = nearestPaths('style.line.loosenes')
      expect(near).toHaveLength(3)
      expect(near[0]).toBe('style.line.looseness')
      expect(nearestPaths('style.line.loosenes')).toEqual(near)
    })

    it('and leaves the layer alone', () => {
      const layer: StyleLayer = { line: { wobble: 0.1 } }
      expect(() => applyStyleSet(layer, 'style.line.loosenes 0.4')).toThrow(/looseness/)
      expect(layer).toEqual({ line: { wobble: 0.1 } })
    })
  })

  describe('refuses a bad value, naming what is valid', () => {
    it('an out-of-range number is refused, never clamped, with the range', () => {
      for (const text of ['style.line.looseness 3', 'style.line.looseness -0.1', 'style.line.looseness 1.0001']) {
        const layer: StyleLayer = {}
        expect(() => applyStyleSet(layer, text), text).toThrow(/must be a number from 0 to 1, got/)
        expect(layer, text).toEqual({})
      }
      for (const text of ['paint.value.terminatorSoftness 5', 'paint.value.terminatorSoftness -1', 'media.chalk.chroma 0.9', 'media.chalk.chroma 0.4']) {
        const layer: StyleLayer = {}
        expect(() => applyStyleSet(layer, text), text).toThrow(/must be a number from -?[\d.]+ to -?[\d.]+, got/)
        expect(layer, text).toEqual({})
      }
      expect(setMessage('paint.value.terminatorSoftness 5')).toBe('@style-set paint.value.terminatorSoftness must be a number from 0 to 1, got "5"')
      expect(setMessage('media.chalk.chroma 0.9')).toBe('@style-set media.chalk.chroma must be a number from 0.5 to 0.7, got "0.9"')
    })

    it('a whole-number setting is refused when it is not whole, never rounded, and a measure on a slider that moves by 1 is not one', () => {
      for (const text of ['paint.seed 3.5', 'paint.light.worldFixed 0.5', 'paint.light.shadows 0.5', 'paint.mix.loadMin 2.5', 'paint.mix.loadMax 9.25', 'paint.roles.block.bristles 7.5', 'paint.roles.line.bristles 4.1']) {
        const layer: StyleLayer = {}
        expect(() => applyStyleSet(layer, text), text).toThrow(/must be a whole number from -?[0-9.]+ to -?[0-9.]+, got/)
        expect(layer, text).toEqual({})
      }
      expect(setMessage('paint.seed 3.5')).toBe('@style-set paint.seed must be a whole number from 1 to 999, got "3.5"')
      expect(setMessage('paint.roles.dab.bristles 5.5')).toBe('@style-set paint.roles.dab.bristles must be a whole number from 1 to 24, got "5.5"')
      // The same words as a figure style's whole-number setting.
      expect(setMessage('style.line.passes 2.5')).toBe('@style-set style.line.passes must be a whole number from 1 to 3, got "2.5"')
      expect(messageOf(() => applyStyleDirective({}, 'style-passes', '2.5'))).toBe('@style-passes must be a whole number from 1 to 3, got "2.5"')
      // A whole number out of range is the range's refusal.
      expect(setMessage('paint.seed 1000')).toBe('@style-set paint.seed must be a number from 1 to 999, got "1000"')
      expect(setMessage('paint.roles.block.bristles 0')).toBe('@style-set paint.roles.block.bristles must be a number from 1 to 24, got "0"')
      // A whole number, written as one, is taken: 3, 3.0 and 3e0.
      const layer: StyleLayer = {}
      for (const text of ['paint.seed 3', 'paint.seed 3.0', 'paint.roles.block.bristles 7', 'paint.light.worldFixed 0', 'paint.mix.loadMax 8']) applyStyleSet(layer, text)
      expect(layer.set).toEqual({ 'paint.seed': 3, 'paint.roles.block.bristles': 7, 'paint.light.worldFixed': 0, 'paint.mix.loadMax': 8 })
      // A measure that moves by 1 on its slider is not whole: 22.5 degrees is a fine azimuth.
      const measures: StyleLayer = {}
      for (const text of ['paint.light.azimuth 22.5', 'paint.light.elevation 38.5', 'paint.detect.dabMinPx 12.5', 'paint.roles.block.length 46.5', 'paint.environment.hue 250.5', 'paint.particles.targetPer10kPx 90.5']) {
        applyStyleSet(measures, text)
      }
      expect(measures.set).toEqual({
        'paint.light.azimuth': 22.5,
        'paint.light.elevation': 38.5,
        'paint.detect.dabMinPx': 12.5,
        'paint.roles.block.length': 46.5,
        'paint.environment.hue': 250.5,
        'paint.particles.targetPer10kPx': 90.5,
      })
    })

    it('takes the ends of the range', () => {
      const layer: StyleLayer = {}
      applyStyleSet(layer, 'style.line.looseness 1')
      applyStyleSet(layer, 'paint.value.terminatorSoftness 0')
      applyStyleSet(layer, 'media.chalk.chroma 0.7')
      expect(layer).toEqual({ line: { looseness: 1 }, set: { [SOFT]: 0, [CHROMA]: 0.7 } })
    })

    it('agrees with the "@style-<setting>" form, word for word but for the name', () => {
      const viaSet = messageOf(() => applyStyleSet({}, 'style.line.looseness 3'))
      const viaDirective = messageOf(() => applyStyleDirective({}, 'style-looseness', '3'))
      expect(viaSet).toBe('@style-set style.line.looseness must be a number from 0 to 1, got "3"')
      expect(viaDirective).toBe('@style-looseness must be a number from 0 to 1, got "3"')
      for (const [setText, name, value] of [
        ['style.line.passes 2.5', 'style-passes', '2.5'],
        ['style.line.type crayon', 'style-line', 'crayon'],
        ['style.fill.type dots', 'style-fill', 'dots'],
        ['style.paper.tint navy', 'style-tint', 'navy'],
        ['style.colour.saturation lots', 'style-saturation', 'lots'],
        ['style.seed 10000', 'style-seed', '10000'],
      ]) {
        const a = messageOf(() => applyStyleSet({}, setText))
        const b = messageOf(() => applyStyleDirective({}, name, value))
        expect(a.replace(/^@style-set style\.[a-z.]+ /, ''), setText).toBe(b.replace(/^@style-[a-z]+ /, ''))
      }
    })

    it('a choice names the choices, a colour names the colours, a number that is not one says so', () => {
      expect(setMessage('paint.canvas.weave silk')).toBe('@style-set paint.canvas.weave must be one of duck, linen, got "silk"')
      expect(setMessage('style.line.type crayon')).toMatch(/technical, ink, brush, pencil, marker, chalk/)
      expect(setMessage('style.paper.tint navy')).toMatch(/red, orange, yellow/)
      expect(setMessage('paint.value.terminatorSoftness soft')).toBe('@style-set paint.value.terminatorSoftness must be a number from 0 to 1, got "soft"')
      expect(setMessage('paint.value.terminatorSoftness NaN')).toMatch(/must be a number from 0 to 1/)
      expect(setMessage('paint.value.terminatorSoftness Infinity')).toMatch(/must be a number from 0 to 1/)
    })

    it('a curve names what a curve is', () => {
      for (const text of [
        'paint.curves.value 0,0',
        'paint.curves.value 0,0 0.5,2 1,1',
        'paint.curves.value 0,0 0,1 1,1',
        'paint.curves.value 0,0 1.5,1',
        'paint.curves.value 0,0 0.5',
        'paint.curves.value [[0,0],[1',
        'paint.curves.value up',
      ]) {
        expect(setMessage(text), text).toMatch(/^@style-set paint\.curves\.value must be a curve: at least two "x,y" points with x rising from 0 to 1 and y from 0 to 1, like "0,0 0\.5,0\.7 1,1" — /)
      }
    })

    it('asks for a path and a value, and for a value after a path', () => {
      expect(setMessage('')).toBe('@style-set needs a setting and a value, like "@style-set: style.line.looseness 0.4"')
      expect(setMessage('style.line.looseness')).toBe('@style-set style.line.looseness must be a number from 0 to 1, got ""')
      expect(setMessage('paint.canvas.weave')).toMatch(/must be one of duck, linen, got ""/)
    })
  })

  describe('in a document', () => {
    it('is refused with its line number, and the figure still draws, without it', () => {
      const good = [FIGURE, '@style: pencil'].join('\n')
      const bad = [FIGURE, '@style: pencil', '@style-set: style.line.looseness 3', '@style-set: style.line.loosenes 0.3', '@style-set: paint.value.terminatorSoftness 5'].join('\n')
      const withoutIt = draw(good)
      const withIt = draw(bad)
      expect(withIt.parsed.errors).toHaveLength(3)
      expect(withIt.parsed.errors.map((e) => e.line)).toEqual([8, 9, 10])
      expect(withIt.parsed.errors[0].message).toBe('@style-set style.line.looseness must be a number from 0 to 1, got "3"')
      expect(withIt.parsed.errors[1].message).toMatch(/^@style-set has no setting "style\.line\.loosenes" — the nearest are style\.line\.looseness/)
      expect(withIt.parsed.errors[2].message).toBe('@style-set paint.value.terminatorSoftness must be a number from 0 to 1, got "5"')
      // Nothing of the refused lines reached the layer, so the figure is the one drawn without them.
      expect(withIt.parsed.config.style).toEqual({ preset: 'pencil' })
      expect(withIt.drawn.errors).toEqual([])
      expect(withIt.drawn.svg).toBe(withoutIt.drawn.svg)
      expect(withIt.drawn.svg).toContain('<svg')
    })

    it('keeps the valid ones beside the refused one', () => {
      const parsed = parseSpec([FIGURE, '@style-set: style.line.looseness 3', '@style-set: style.line.wobble 0.2', '@style-set: paint.value.terminatorSoftness 0.4'].join('\n'))
      expect(parsed.errors).toHaveLength(1)
      expect(parsed.config.style).toEqual({ line: { wobble: 0.2 }, set: { [SOFT]: 0.4 } })
    })

    it('leaves a spec that says nothing with an empty figure layer', () => {
      expect(parseSpec(FIGURE).config.style).toEqual({})
    })
  })

  it('is also read where the style directives are read, by name', () => {
    const layer: StyleLayer = {}
    applyStyleDirective(layer, 'style-set', 'paint.value.terminatorSoftness 0.4')
    expect(layer).toEqual({ set: { [SOFT]: 0.4 } })
  })
})

// ---------------------------------------------------------------------------
// A host's base style, and a theme's, with settings in them
// ---------------------------------------------------------------------------

describe('a base style with settings in it', () => {
  it('keeps the valid settings and names the rest, by registry path', () => {
    const { layer, errors } = checkLayer({
      preset: 'ink',
      line: { wobble: 0.2 },
      set: { [SOFT]: 0.4, 'line.looseness': 0.3, 'paint.value.terminatorSoftnes': 0.4, [CHROMA]: 0.9, 'paint.canvas.weave': 'silk', 'style.seed': 4 },
    } as never)
    expect(layer).toEqual({ preset: 'ink', line: { wobble: 0.2, looseness: 0.3 }, seed: 4, set: { [SOFT]: 0.4 } })
    expect(errors).toEqual([
      expect.stringMatching(/^The base style's set has no setting "paint\.value\.terminatorSoftnes" — the nearest are paint\.value\.terminatorSoftness/),
      'The base style\'s set media.chalk.chroma must be a number from 0.5 to 0.7, got "0.9"',
      'The base style\'s set paint.canvas.weave must be one of duck, linen, got "silk"',
    ])
  })

  it('refuses a whole-number setting that is not whole, in a base style, and takes a measure that is not', () => {
    const { layer, errors } = checkLayer({ set: { 'paint.seed': 3.5, 'paint.roles.form.bristles': 6.5, 'paint.light.azimuth': 22.5, 'paint.mix.loadMin': 4 } } as never)
    expect(errors).toEqual([
      'The base style\'s set paint.seed must be a whole number from 1 to 999, got "3.5"',
      'The base style\'s set paint.roles.form.bristles must be a whole number from 1 to 24, got "6.5"',
    ])
    expect(layer).toEqual({ set: { 'paint.light.azimuth': 22.5, 'paint.mix.loadMin': 4 } })
  })

  it('refuses a set that is not an object, and a value that is not a value', () => {
    expect(checkLayer({ set: 3 } as never).errors).toEqual(["The base style's set must be an object of registry paths and values, got 3"])
    expect(checkLayer({ set: ['a'] } as never).errors).toHaveLength(1)
    expect(checkLayer({ set: { [SOFT]: { a: 1 } } } as never).errors).toEqual([`The base style's set ${SOFT} must be a number from 0 to 1, got {"a":1}`])
    expect(checkLayer({ set: { [LOOSE]: [1] } } as never).errors).toEqual([`The base style's set ${LOOSE} must be a number from 0 to 1, got [1]`])
  })

  it('draws a figure with the settings it kept, and reports the ones it did not', () => {
    const parsed = parseSpec(FIGURE)
    const drawn = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, { preset: 'pencil', set: { [LOOSE]: 0.45, 'style.line.looseness2': 1 } } as never)
    const expected = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, { preset: 'pencil', line: { looseness: 0.45 } })
    expect(drawn.svg).toBe(expected.svg)
    expect(drawn.errors).toHaveLength(1)
    expect(drawn.errors[0].message).toMatch(/no setting "style\.line\.looseness2"/)
  })
})

describe('checking a theme’s style set', () => {
  it('keeps what is valid, normalised, and names what is not', () => {
    const { styles, errors } = checkThemeStyles({
      all: { preset: 'ink', set: { [LOOSE]: '0.3', 'paper.tint': 'teal', nope: 1 } },
      byType: { space: { set: { [SOFT]: 7 } }, figure2d: { preset: 'crayon' }, spaceship: {} },
      sparkle: 1,
    })
    expect(styles).toEqual({
      all: { preset: 'ink', set: { [LOOSE]: 0.3, 'style.paper.tint': '#1f9a92' } },
      byType: { space: { set: {} }, figure2d: {} },
    })
    expect(errors).toEqual([
      expect.stringMatching(/^The theme's styles\.all's set has no setting "nope"/),
      `The theme's styles.byType.space's set ${SOFT} must be a number from 0 to 1, got "7"`,
      `The theme's styles.byType.figure2d's preset must be one of ${PRESET_NAMES.join(', ')}, got "crayon"`,
      `The theme's styles.byType has no graph type "spaceship" — the graph types are ${GRAPH_TYPES.join(', ')}`,
      `The theme's styles has no "sparkle" — it has all and byType`,
    ])
  })

  it('refuses a whole-number setting that is not whole, in a theme’s style set, and takes a measure that is not', () => {
    const { styles, errors } = checkThemeStyles({
      all: { set: { 'paint.seed': 2.5, 'paint.light.azimuth': 22.5 } },
      byType: { space: { set: { 'paint.roles.dab.bristles': 5.5, 'paint.roles.dab.bristles2': 5 } } },
    })
    expect(styles).toEqual({ all: { set: { 'paint.light.azimuth': 22.5 } }, byType: { space: { set: {} } } })
    expect(errors).toEqual([
      'The theme\'s styles.all\'s set paint.seed must be a whole number from 1 to 999, got "2.5"',
      'The theme\'s styles.byType.space\'s set paint.roles.dab.bristles must be a whole number from 1 to 24, got "5.5"',
      expect.stringMatching(/^The theme's styles\.byType\.space's set has no setting "paint\.roles\.dab\.bristles2"/),
    ])
  })

  it('takes nothing, null and undefined as an empty set, and refuses what is not a set', () => {
    for (const none of [undefined, null]) expect(checkThemeStyles(none)).toEqual({ styles: {}, errors: [] })
    for (const bad of [3, 'ink', ['all']]) {
      const { styles, errors } = checkThemeStyles(bad)
      expect(styles).toEqual({})
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatch(/^The theme's styles must be an object such as/)
    }
    expect(checkSettingsLayer(3, 'A layer').errors[0]).toMatch(/^A layer must be an object such as/)
  })

  it('reads a theme whose styles are not a set as having none', () => {
    expect(themeStylesOf({ styles: 'ink' })).toEqual({})
    const theme = resolveTheme({ styles: { all: { seed: 3 } } })
    expect(themeStylesOf(theme)).toEqual({ all: {} })
  })
})

// ---------------------------------------------------------------------------
// Several layers as one
// ---------------------------------------------------------------------------

describe('collapseLayers', () => {
  const LIBRARY: (SettingsLayer | null | undefined)[] = [
    undefined,
    null,
    {},
    { preset: 'pencil' },
    { preset: 'ink', set: { [LOOSE]: 0.4, 'style.seed': 5, [SOFT]: 0.3 } },
    { preset: 'marker', set: { 'style.paper.type': 'graph', [CHROMA]: 0.7 } },
    { preset: 'clean' },
    { preset: 'crayon' },
    { set: { [LOOSE]: 0.1, 'style.line.type': 'brush', 'style.seed': 9 } },
    { set: { [SOFT]: 0.6, 'paint.canvas.weave': 'duck', 'board.tilt': 0.8 } },
    { preset: 'pencil', set: { 'style.fill.type': 'crosshatch', 'paint.curves.value': [[0, 0], [0.5, 0.7], [1, 1]] } },
  ]

  it('resolves, as the one layer, exactly as the layers would one after the other', () => {
    // The stack applies its layers one after the other: the graph type's defaults, the theme's, the document's.
    const sequential = (a: SettingsLayer | null | undefined, b: SettingsLayer | null | undefined, c: SettingsLayer | null | undefined) =>
      resolveSettings({ typeDefaults: { space: a ?? undefined }, theme: { all: b ?? undefined }, document: c ?? undefined }, 'space')
    const collapsed = (layers: (SettingsLayer | null | undefined)[]) => resolveSettings({ figure: collapseLayers(layers) }, 'space')
    for (const a of LIBRARY) {
      expect(collapsed([a]), JSON.stringify([a])).toEqual(sequential(a, undefined, undefined))
      for (const b of LIBRARY) {
        expect(collapsed([a, b]), JSON.stringify([a, b])).toEqual(sequential(a, b, undefined))
        for (const c of LIBRARY) expect(collapsed([a, b, c]), JSON.stringify([a, b, c])).toEqual(sequential(a, b, c))
      }
    }
  })

  it('is nothing for no layers, and keeps the seed and the other settings a later preset does not reset', () => {
    expect(collapseLayers([])).toBeUndefined()
    expect(collapseLayers([undefined, null])).toBeUndefined()
    const merged = collapseLayers([{ preset: 'ink', set: { 'style.seed': 5, [LOOSE]: 0.4, [SOFT]: 0.3 } }, { preset: 'pencil' }])!
    expect(merged.preset).toBe('pencil')
    expect(merged.set).toEqual({ 'style.seed': 5, [SOFT]: 0.3 })
  })

  it('does not change the layers it is given, or share their settings', () => {
    const a: SettingsLayer = { preset: 'ink', set: { [LOOSE]: 0.4 } }
    const b: SettingsLayer = { set: { [SOFT]: 0.3 } }
    const snapshot = JSON.stringify([a, b])
    const merged = collapseLayers([a, b])!
    merged.set![LOOSE] = 0.9
    expect(JSON.stringify([a, b])).toBe(snapshot)
  })
})
