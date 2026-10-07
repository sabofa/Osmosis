import { describe, expect, it } from 'vitest'
import { CURVE_SCHEMA, DEFAULT_PAINT_PARAMS, PARAM_SCHEMA, getParam } from '../../space/paint/params'
import { MEDIA } from '../media'
import { PRESETS } from '../presets'
import { BOARD_BASES, BOARD_TILT } from '../theme/derive'
import { BOARD_NAMES, GRAPH_TYPES, MEDIUM_NAMES } from '../theme/types'
import { readToken, TOKENS } from '../tokens'
import { BOARD_MEANINGS } from './meanings/boards'
import { MEDIA_MEANINGS } from './meanings/media'
import { PAINT_MEANINGS } from './meanings/paint'
import { STYLE_MEANINGS } from './meanings/style'
import { EXTRA_PAINT_SETTINGS, REGISTRY, settingAt } from './registry'

// The paths the sources imply, written out here by the brief's rules and not read back from the registry.
const tokenPath = (token: (typeof TOKENS)[number]) => (token.group === 'seed' ? 'style.seed' : `style.${token.group}.${token.key}`)
const STYLE_PATHS = TOKENS.map(tokenPath)
const PAINT_PATHS = [
  ...PARAM_SCHEMA.map((spec) => `paint.${spec.path}`),
  ...CURVE_SCHEMA.map((spec) => `paint.${spec.path}`),
  ...EXTRA_PAINT_SETTINGS.map((spec) => `paint.${spec.path}`),
]
const MEDIA_PATHS = MEDIUM_NAMES.flatMap((name) => MEDIA[name].settings.map((spec) => `media.${name}.${spec.key}`))
const BOARD_PATHS = ['board.tilt', ...BOARD_NAMES.map((name) => `board.${name}.chromaCap`)]

const count = (path: string) => REGISTRY.filter((spec) => spec.path === path).length
const inSection = (prefix: string) => REGISTRY.filter((spec) => spec.path.startsWith(`${prefix}.`))

describe('every setting has exactly one entry', () => {
  it('has one entry per source setting, and nothing else', () => {
    const wanted = [...STYLE_PATHS, ...PAINT_PATHS, ...MEDIA_PATHS, ...BOARD_PATHS]
    expect(REGISTRY.length).toBe(wanted.length)
    expect(new Set(REGISTRY.map((spec) => spec.path))).toEqual(new Set(wanted))
  })

  it('has unique paths', () => {
    const paths = REGISTRY.map((spec) => spec.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('matches each source setting by path, once', () => {
    for (const path of [...STYLE_PATHS, ...PAINT_PATHS, ...MEDIA_PATHS, ...BOARD_PATHS]) expect(count(path), path).toBe(1)
  })

  it('counts each section against its source', () => {
    expect(inSection('style')).toHaveLength(TOKENS.length)
    expect(inSection('paint')).toHaveLength(PARAM_SCHEMA.length + CURVE_SCHEMA.length + EXTRA_PAINT_SETTINGS.length)
    expect(inSection('media')).toHaveLength(MEDIUM_NAMES.reduce((sum, name) => sum + MEDIA[name].settings.length, 0))
    expect(inSection('board')).toHaveLength(1 + BOARD_NAMES.length)
    expect(REGISTRY.length).toBe(
      TOKENS.length +
        PARAM_SCHEMA.length +
        CURVE_SCHEMA.length +
        EXTRA_PAINT_SETTINGS.length +
        MEDIUM_NAMES.reduce((sum, name) => sum + MEDIA[name].settings.length, 0) +
        1 +
        BOARD_NAMES.length
    )
  })

  it('has unique source paths too (a doubled source entry would hide behind the count)', () => {
    expect(new Set(STYLE_PATHS).size).toBe(STYLE_PATHS.length)
    expect(new Set(PAINT_PATHS).size).toBe(PAINT_PATHS.length)
    expect(new Set(MEDIA_PATHS).size).toBe(MEDIA_PATHS.length)
  })
})

describe('the registry is assembled from the sources, not copied', () => {
  it('reads each style token its range and choices, and clean as its default', () => {
    for (const token of TOKENS) {
      const spec = settingAt(tokenPath(token))!
      expect(spec.label).toBe(token.label)
      expect(spec.type).toBe(token.kind)
      if (token.kind === 'number') {
        expect([spec.min, spec.max, spec.step]).toEqual([token.min, token.max, token.step])
      }
      if (token.kind === 'choice') expect(spec.choices).toEqual(token.choices)
      // a style starts as clean with seed 0 (resolveStyle)
      expect(spec.default).toBe(token.group === 'seed' ? 0 : readToken(PRESETS.clean, token))
    }
  })

  it('reads each paint setting its range from the Paint Lab and its default from the defaults', () => {
    for (const schema of PARAM_SCHEMA) {
      const spec = settingAt(`paint.${schema.path}`)!
      expect(spec.type).toBe('number')
      expect([spec.label, spec.group, spec.min, spec.max, spec.step]).toEqual([schema.label, schema.group, schema.min, schema.max, schema.step])
      expect(spec.default).toBe(getParam(DEFAULT_PAINT_PARAMS, schema.path))
    }
  })

  it('reads each curve its y range from the curve editor and its points from the defaults', () => {
    for (const schema of CURVE_SCHEMA) {
      const spec = settingAt(`paint.${schema.path}`)!
      expect(spec.type).toBe('curve')
      expect([spec.label, spec.group, spec.min, spec.max]).toEqual([schema.label, schema.group, schema.yMin, schema.yMax])
      const points = (getParam(DEFAULT_PAINT_PARAMS, schema.path) as unknown) as number[][]
      expect(spec.default).toEqual(points)
      // a copy: editing the registry's curve never edits the engine's defaults
      expect(spec.default).not.toBe(points)
    }
  })

  it('reads each medium setting from the medium', () => {
    for (const name of MEDIUM_NAMES) {
      for (const setting of MEDIA[name].settings) {
        const spec = settingAt(`media.${name}.${setting.key}`)!
        expect([spec.label, spec.min, spec.max, spec.step, spec.default]).toEqual([setting.label, setting.min, setting.max, setting.step, setting.default])
        expect(spec.group).toBe(name)
      }
    }
  })

  it('reads the board settings from the board derivation', () => {
    expect(settingAt('board.tilt')!.default).toBe(BOARD_TILT)
    for (const name of BOARD_NAMES) expect(settingAt(`board.${name}.chromaCap`)!.default).toBe(BOARD_BASES[name].maxChroma)
  })

  it('keeps the board bases the registry reads frozen', () => {
    expect(Object.isFrozen(BOARD_BASES)).toBe(true)
    for (const name of BOARD_NAMES) expect(Object.isFrozen(BOARD_BASES[name]), name).toBe(true)
  })

  it('reads the extra painter settings, which have no slider, from the defaults', () => {
    expect(EXTRA_PAINT_SETTINGS.map((extra) => extra.path)).toEqual(['canvas.weave', 'particles.dragDensity'])
    const weave = settingAt('paint.canvas.weave')!
    expect(weave.type).toBe('choice')
    expect(weave.choices).toEqual(['duck', 'linen'])
    expect(weave.default).toBe(DEFAULT_PAINT_PARAMS.canvas.weave)
    const drag = settingAt('paint.particles.dragDensity')!
    expect(drag.type).toBe('number')
    expect(drag.default).toBe(DEFAULT_PAINT_PARAMS.particles.dragDensity)
    // and they are not Paint Lab sliders: PARAM_SCHEMA is untouched
    expect(PARAM_SCHEMA.some((schema) => schema.path === 'canvas.weave' || schema.path === 'particles.dragDensity')).toBe(false)
  })
})

// Every leaf of the painter's defaults is a setting: a number, a string, a tuple's entry, or a whole curve.
function leaves(value: unknown, path: string, out: string[]): string[] {
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) out.push(path)
    else value.forEach((item, i) => leaves(item, `${path}.${i}`, out))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) leaves(item, path === '' ? key : `${path}.${key}`, out)
  } else out.push(path)
  return out
}

describe('no painter setting is missing', () => {
  const found = leaves(DEFAULT_PAINT_PARAMS, '', [])

  it('walks every leaf of DEFAULT_PAINT_PARAMS, curves included, and finds a registry entry for it', () => {
    expect(found.length).toBeGreaterThan(200)
    expect(found).toContain('curves.value')
    expect(found).toContain('edges.wContrast.2')
    expect(found).toContain('canvas.tone.1')
    expect(found).toContain('canvas.weave')
    const missing = found.filter((path) => settingAt(`paint.${path}`) === undefined)
    expect(missing).toEqual([])
  })

  it('has no paint entry that is not a leaf of the defaults', () => {
    const known = new Set(found)
    const phantom = REGISTRY.filter((spec) => spec.path.startsWith('paint.') && !known.has(spec.path.slice('paint.'.length))).map((spec) => spec.path)
    expect(phantom).toEqual([])
  })
})

describe('every entry says what it means', () => {
  it('has a meaning of at least 20 characters that is not just the label', () => {
    for (const spec of REGISTRY) {
      expect(spec.meaning.length, spec.path).toBeGreaterThanOrEqual(20)
      expect(spec.meaning, spec.path).not.toBe(spec.label)
      expect(spec.meaning, spec.path).not.toBe(spec.path)
      expect(spec.meaning.trim(), spec.path).toBe(spec.meaning)
    }
  })

  // The first sentence is what the guide's tables show by itself: it must stand alone, and be short.
  const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text

  it('opens with a first sentence that stands alone in at most 200 characters', () => {
    const bad: string[] = []
    for (const spec of REGISTRY) {
      const first = firstSentence(spec.meaning)
      const long = first.length > 200
      const short = first.length < 20
      // a sentence that leans on the one before it does not stand alone
      const leans = /^(It|Its|This|That|These|Those|They|Their|Here|There|Then|And|But|So)/.test(first)
      const open = !/[.!?]$/.test(first)
      if (long || short || leans || open) bad.push(`${spec.path} (${first.length}): ${first}`)
    }
    expect(bad).toEqual([])
  })

  it('quotes no default as a number in the prose (the registry carries it, and a copy goes stale)', () => {
    for (const spec of REGISTRY) expect(spec.meaning, spec.path).not.toMatch(/\bdefaults?\s*(?:is|are|of|at|=|:)?\s*\(?-?\d/i)
  })

  // Nothing draws a medium or a board yet. The task that wires one removes its paths from this check.
  const NOT_DRAWN_YET = REGISTRY.filter((spec) => spec.path.startsWith('media.') || spec.path.startsWith('board.')).map((spec) => spec.path)

  it('says "Not drawn yet:" in the first sentence of every medium and board setting, and of no other', () => {
    expect(NOT_DRAWN_YET).toHaveLength(13)
    for (const spec of REGISTRY) {
      const says = firstSentence(spec.meaning).startsWith('Not drawn yet:')
      expect(says, spec.path).toBe(NOT_DRAWN_YET.includes(spec.path))
    }
  })

  it('is written in painter terms, with no code words outside the setting paths it quotes', () => {
    const CODE = /\b(shader|uniform|glsl|webgl|g-buffer|gbuffer|smoothstep|clamp|clamped|float|function|variable|boolean|null|undefined|array|callback|vertex|framebuffer|gpu|cpu|enum|struct|param|params)\b/i
    for (const spec of REGISTRY) {
      expect(spec.meaning.replace(/`[^`]*`/g, ''), spec.path).not.toMatch(CODE)
    }
  })

  it('has no setting that applies to nothing', () => {
    for (const spec of REGISTRY) {
      expect(spec.appliesTo.graphTypes.length, spec.path).toBeGreaterThanOrEqual(1)
      for (const type of spec.appliesTo.graphTypes) expect(GRAPH_TYPES, spec.path).toContain(type)
      if (spec.appliesTo.media !== 'all') {
        expect(spec.appliesTo.media.length, spec.path).toBeGreaterThanOrEqual(1)
        for (const medium of spec.appliesTo.media) expect(MEDIUM_NAMES, spec.path).toContain(medium)
      }
    }
  })

  it('names only real paths in its interactions, never itself, never twice', () => {
    for (const spec of REGISTRY) {
      for (const other of spec.interactions) expect(settingAt(other), `${spec.path} -> ${other}`).toBeDefined()
      expect(spec.interactions, spec.path).not.toContain(spec.path)
      expect(new Set(spec.interactions).size, spec.path).toBe(spec.interactions.length)
    }
  })

  it('makes every interaction run both ways', () => {
    for (const spec of REGISTRY) {
      for (const other of spec.interactions) expect(settingAt(other)!.interactions, `${other} should name ${spec.path}`).toContain(spec.path)
    }
  })

  it('has no interaction between two settings the code keeps independent', () => {
    // the sky and bounce LIGHTS lift values; the sky and bounce TINTS colour them: no code joins the two
    expect(settingAt('paint.light.bounce')!.interactions).not.toContain('paint.curve.bounceTint')
    expect(settingAt('paint.light.sky')!.interactions).not.toContain('paint.curve.skyTint')
    expect(settingAt('paint.curve.bounceTint')!.interactions).not.toContain('paint.light.bounce')
    expect(settingAt('paint.curve.skyTint')!.interactions).not.toContain('paint.light.sky')
  })

  it('has no interaction between settings that only add, or that never touch', () => {
    // a faint boundary can still stop a stroke: the contrast floor and the stop level are independent
    expect(settingAt('paint.detect.edgeMinContrast')!.interactions).not.toContain('paint.edges.stopAt')
    expect(settingAt('paint.detect.edgeMinContrast')!.interactions).not.toContain('paint.edges.bleedAt')
    // the mix's hue turns and the planes' hue steps add on top of the capped swing: they do not cap each other
    for (const path of ['paint.mix.hueMin', 'paint.mix.hueMax', 'paint.curve.planeStepA', 'paint.curve.planeStepB', 'paint.curves.hAdjust']) {
      expect(settingAt('paint.curve.shiftMax')!.interactions, path).not.toContain(path)
      expect(settingAt(path)!.interactions, path).not.toContain('paint.curve.shiftMax')
    }
  })

  it('says where the baked painting and the live path differ, in the settings where they do', () => {
    const both = (path: string, ...words: RegExp[]) => {
      const text = settingAt(path)!.meaning
      for (const word of words) expect(text, `${path}: ${word}`).toMatch(word)
    }
    // (the baked painting is the default; the live path is baking off, or the light fixed to the camera)
    for (const path of ['paint.mix.flipHue', 'paint.mix.flipChroma']) both(path, /baked painting/, /live path/, /outline/)
    for (const path of ['paint.mix.loadMin', 'paint.mix.loadMax', 'paint.mix.loadBreakPx']) both(path, /baked painting/, /[Ll]ive/, /outline/)
    for (const weight of ['wFocal', 'wDepth']) for (const kind of [0, 1, 2]) both(`paint.edges.${weight}.${kind}`, /baked painting/, /live path/)
    both('paint.edges.wDepth.1', /no depth term/)
    both('paint.edges.wShadowDist', /baked painting/, /live/)
    both('paint.edges.planeMinPx', /baked painting/, /live path/, /216/)
    both('paint.edges.planeCellDeg', /baked painting/, /live path/)
    both('paint.detect.edgeReachPx', /[Ll]ive/, /baked painting/, /outline/)
    both('paint.light.shadows', /live path/, /baked painting/, /no effect/)
    both('paint.canvas.texture', /canvas\.weave/)
    for (const path of ['paint.curve.devL', 'paint.curve.devC', 'paint.curve.devH']) both(path, /four times/, /jitter/)
    expect(settingAt('paint.roles.line.load')!.meaning).not.toMatch(/heavier loaded start/)
    expect(settingAt('paint.roles.block.load')!.meaning).toMatch(/heavier loaded start/)
  })

  it('names the interactions the review found missing', () => {
    const shift = settingAt('paint.curve.shiftMax')!.interactions
    for (const path of ['kWarm', 'kCool', 'warmHue', 'coolHue', 'tintWarm', 'tintCool', 'skyTint', 'bounceTint']) expect(shift, path).toContain(`paint.curve.${path}`)
    const terminator = settingAt('paint.value.terminatorSoftness')!.interactions
    for (const weight of ['wContrast', 'wCurvature', 'wFocal', 'wLight', 'wDepth']) expect(terminator, weight).toContain(`paint.edges.${weight}.0`)
    for (const role of ['block', 'form', 'scumble', 'glaze', 'reflected']) {
      expect(settingAt(`paint.roles.${role}.density`)!.interactions, role).toContain('paint.particles.zoomGrowMax')
    }
    expect(settingAt('paint.particles.zoomGrowMax')!.interactions).toContain('paint.roles.block.density')
  })

  it('says the underpainting takes the block-in mix at half strength, in the two settings that move it', () => {
    for (const path of ['paint.mix.roleBlock', 'paint.mix.strength']) {
      const text = settingAt(path)!.meaning
      expect(text, path).toMatch(/underpainting/)
      expect(text, path).toMatch(/half strength/)
    }
  })

  it('has no meaning or unit for a path the sources lack', () => {
    const known = new Set(REGISTRY.map((spec) => spec.path))
    for (const [section, table] of Object.entries({ style: STYLE_MEANINGS, paint: PAINT_MEANINGS, media: MEDIA_MEANINGS, board: BOARD_MEANINGS })) {
      for (const path of Object.keys(table)) {
        expect(known.has(path), `${section}: ${path}`).toBe(true)
        expect(path.startsWith(`${section}.`), `${section}: ${path}`).toBe(true)
      }
    }
  })

  it('names the role in a stroke role setting, and says it differently for each role', () => {
    const fields = Object.keys(DEFAULT_PAINT_PARAMS.roles.block)
    expect(fields).toHaveLength(10)
    for (const field of fields) {
      const texts = Object.keys(DEFAULT_PAINT_PARAMS.roles).map((role) => {
        const spec = settingAt(`paint.roles.${role}.${field}`)!
        expect(spec.meaning.toLowerCase(), spec.path).toContain(role)
        return spec.meaning
      })
      expect(new Set(texts).size, field).toBe(texts.length)
    }
  })

  it('says which kind of edge an edge weight is about, and says it differently for each', () => {
    const kinds = ['internal', 'silhouette', 'shadow']
    for (const weight of ['wContrast', 'wCurvature', 'wFocal', 'wLight', 'wDepth']) {
      const texts = kinds.map((kind, i) => {
        const spec = settingAt(`paint.edges.${weight}.${i}`)!
        expect(spec.meaning.toLowerCase(), spec.path).toMatch(kind === 'internal' ? /plane|inside/ : new RegExp(kind))
        return spec.meaning
      })
      expect(new Set(texts).size, weight).toBe(3)
    }
  })
})

describe('defaults are inside the range', () => {
  it('keeps every numeric default inside [min, max], with a positive step', () => {
    for (const spec of REGISTRY) {
      if (spec.type !== 'number') continue
      expect(typeof spec.default, spec.path).toBe('number')
      expect(spec.min, spec.path).toBeDefined()
      expect(spec.max, spec.path).toBeDefined()
      expect(spec.step, spec.path).toBeGreaterThan(0)
      expect(spec.default as number, spec.path).toBeGreaterThanOrEqual(spec.min!)
      expect(spec.default as number, spec.path).toBeLessThanOrEqual(spec.max!)
      expect(spec.min!, spec.path).toBeLessThan(spec.max!)
    }
  })

  it('keeps every choice default among its choices and every colour default a theme or hex colour', () => {
    for (const spec of REGISTRY) {
      if (spec.type === 'choice') {
        expect(spec.choices!.length, spec.path).toBeGreaterThan(1)
        expect(spec.choices, spec.path).toContain(spec.default)
      }
      if (spec.type === 'colour') expect(String(spec.default), spec.path).toMatch(/^(theme|#[0-9a-f]{6})$/)
      // only numbers have a step, and only numbers and curves a range
      if (spec.type !== 'number') expect(spec.step, spec.path).toBeUndefined()
      if (spec.type === 'choice' || spec.type === 'colour') expect([spec.min, spec.max], spec.path).toEqual([undefined, undefined])
    }
  })

  it('keeps every curve default as ascending points over 0..1 inside its y range', () => {
    const curves = REGISTRY.filter((spec) => spec.type === 'curve')
    expect(curves).toHaveLength(CURVE_SCHEMA.length)
    for (const spec of curves) {
      const points = spec.default as number[][]
      expect(points.length, spec.path).toBeGreaterThanOrEqual(2)
      points.forEach(([x, y], i) => {
        expect(x, spec.path).toBeGreaterThanOrEqual(0)
        expect(x, spec.path).toBeLessThanOrEqual(1)
        expect(y, spec.path).toBeGreaterThanOrEqual(spec.min!)
        expect(y, spec.path).toBeLessThanOrEqual(spec.max!)
        if (i > 0) expect(x, spec.path).toBeGreaterThan(points[i - 1][0])
      })
    }
  })
})

describe('where each setting applies', () => {
  it('gives the figure styles to both figure types, and the generic groups to the other drawn types too', () => {
    for (const spec of inSection('style')) {
      expect(spec.appliesTo.media, spec.path).toBe('all')
      expect(spec.appliesTo.graphTypes, spec.path).toContain('figure2d')
      expect(spec.appliesTo.graphTypes, spec.path).toContain('figure3d')
      const generic = /^style\.(paper|colour|lettering|seed)/.test(spec.path)
      for (const type of ['graph2d', 'table', 'space'] as const) expect(spec.appliesTo.graphTypes.includes(type), `${spec.path} ${type}`).toBe(generic)
    }
  })

  it('gives every paint setting to the space engine alone, in every medium', () => {
    for (const spec of inSection('paint')) {
      expect(spec.appliesTo.graphTypes, spec.path).toEqual(['space'])
      expect(spec.appliesTo.media, spec.path).toBe('all')
    }
  })

  it('gives every medium setting to every graph type, in its own medium only', () => {
    for (const name of MEDIUM_NAMES) {
      for (const spec of inSection(`media.${name}`)) {
        expect(spec.appliesTo.graphTypes, spec.path).toEqual(GRAPH_TYPES)
        expect(spec.appliesTo.media, spec.path).toEqual([name])
      }
    }
  })

  it('gives the board settings to every graph type, in the media that draw on a board', () => {
    for (const spec of inSection('board')) {
      expect(spec.appliesTo.graphTypes, spec.path).toEqual(GRAPH_TYPES)
      expect(spec.appliesTo.media, spec.path).not.toBe('all')
    }
    expect(settingAt('board.tilt')!.appliesTo.media).toEqual(['chalk', 'whiteboard'])
    expect(settingAt('board.blackboard.chromaCap')!.appliesTo.media).toEqual(['chalk'])
    expect(settingAt('board.greenboard.chromaCap')!.appliesTo.media).toEqual(['chalk'])
    expect(settingAt('board.whiteboard.chromaCap')!.appliesTo.media).toEqual(['whiteboard'])
  })
})

describe('settingAt', () => {
  it('finds a figure style, a deep paint path, a tuple entry, a curve, a medium setting and a board setting', () => {
    expect(settingAt('style.line.looseness')?.type).toBe('number')
    expect(settingAt('style.seed')?.default).toBe(0)
    expect(settingAt('paint.value.terminatorSoftness')?.default).toBe(DEFAULT_PAINT_PARAMS.value.terminatorSoftness)
    expect(settingAt('paint.roles.glaze.wet')?.group).toBe('Stroke: glaze')
    expect(settingAt('paint.edges.wContrast.1')?.default).toBe(DEFAULT_PAINT_PARAMS.edges.wContrast[1])
    expect(settingAt('paint.canvas.tone.2')?.default).toBe(DEFAULT_PAINT_PARAMS.canvas.tone[2])
    expect(settingAt('paint.curves.value')?.type).toBe('curve')
    expect(settingAt('media.chalk.chroma')?.default).toBe(0.6)
    expect(settingAt('board.tilt')?.default).toBe(0.5)
    expect(settingAt('board.whiteboard.chromaCap')?.default).toBe(0.012)
  })

  it('finds nothing for a path that is not a setting', () => {
    expect(settingAt('')).toBeUndefined()
    expect(settingAt('paint')).toBeUndefined()
    expect(settingAt('paint.value')).toBeUndefined()
    expect(settingAt('paint.value.nope')).toBeUndefined()
    expect(settingAt('media.clean.chroma')).toBeUndefined()
    expect(settingAt('toString')).toBeUndefined()
    expect(settingAt('__proto__')).toBeUndefined()
  })

  it('returns the registry\'s own entries', () => {
    for (const spec of REGISTRY) expect(settingAt(spec.path)).toBe(spec)
  })
})

describe('the registry is frozen', () => {
  it('cannot be edited by a caller', () => {
    expect(Object.isFrozen(REGISTRY)).toBe(true)
    for (const spec of REGISTRY) {
      expect(Object.isFrozen(spec), spec.path).toBe(true)
      expect(Object.isFrozen(spec.interactions), spec.path).toBe(true)
    }
  })
})
