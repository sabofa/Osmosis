// The settings sweep: how much each registry setting moves the picture, for the figures, media,
// backgrounds (T7.1-T7.2) and paint (T7.3) groups.
//
//   npx vite-node tools/settings-sweep.mts [--only <path prefix>] [--relabel]       (from graph-engine/)
//
// --relabel re-applies the ratings (incl. render-only) to the existing file from its stored numbers; nothing is measured.
//
// writes ../docs/styles/sweep.json (SweepFile, src/style/settings/sweepTypes.ts). With --only, just the paths
// that start with the prefix are re-measured and MERGED into the file already there (their entries replaced, the
// rest kept, all sorted by path). A full run replaces every entry (the paint group alone takes about 10 minutes:
// `--only paint.` runs just it). The file holds no timing; the run time is printed.
// Deterministic: every render is seeded, and nothing here reads a clock or Math.random.
//
// Not covered by tsconfig.app.json (include: src) nor tsconfig.node.json (include: vite.config.ts): run by vite-node.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXAMPLES } from '../src/examples'
import { lchToLab, linearToOklab } from '../src/space/paint/model/colour'
import { buildParticles, paintFrame } from '../src/space/paint/model/index'
import { flatColours, sphereGBuffer } from '../src/space/paint/model/testing'
import { CANVAS, SCENE, viewOf } from '../src/space/paint/model/valueFinalFixture'
import { EDGE_CLASSES, PATH_POINTS, ROLES, type GBuffer, type ParticleSet, type PaintFrame, type PaintView } from '../src/space/paint/types'
import type { PaintParams } from '../src/space/paint/params'
import { toPaintParams } from '../src/style/settings/paintParams'
import { renderFigure } from '../src/figure/render'
import { parseSpec } from '../src/parser/parseSpec'
import { LIGHT_PALETTE } from '../src/render/palette'
import { fromOklch, toOklch } from '../src/style/color'
import { MEDIA } from '../src/style/media'
import { paperBaseColour, paperKey } from '../src/style/papers/generated'
import type { GeneratedPaperType } from '../src/style/papers/generate/types'
import { tilePixels } from '../src/style/papers/host'
import { GUIDE } from '../src/style/settings/guide'
import { isRenderOnly } from './sweepRenderOnly'
import { activeRange, EDGES, rate, safeRange, saturates } from '../src/style/settings/sweepRate'
import type { SweepEngine, SweepEntry, SweepFile, SweepMeasure, SweepRating } from '../src/style/settings/sweepTypes'
import type { GuideEntry } from '../src/style/settings/types'
import { blendOver, normaliseHex } from '../src/style/theme/contrast'
import { BUILTIN_LIGHT, BUILTIN_THEME_IDS } from '../src/style/theme/defaults'
import { deriveBoards } from '../src/style/theme/derive'
import { defaultTheme, resolveTheme } from '../src/style/theme/adapter'
import { BOARD_NAMES, ROLE_KEYS, type BoardName, type Hex, type ThemeInput } from '../src/style/theme/types'

const STEPS = 9
const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../../docs/styles/sweep.json')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Three figures: a flat one with measures and lettering, one with a shaded region (fills, hatching), and a solid.
const FIGURE_FIXTURES = ['Measured + notation', 'Square minus its circle', 'Cube and its net'] as const
// A figure setting is read only in a look that uses it (hatching is not drawn by the clean pen), so each is
// swept over four looks and the change kept is the largest of them: how much the setting can move the picture.
const LOOKS = ['ink', 'pencil', 'marker', 'blackboard'] as const
const TILE = 256

function themeFromTokens(id: (typeof BUILTIN_THEME_IDS)[number]): ThemeInput {
  const { tokens, good, bad } = BUILTIN_LIGHT[id]
  return resolveTheme({
    mode: 'light',
    colours: {
      surface: tokens['--surface'],
      ink: tokens['--ink'],
      muted: tokens['--muted'],
      line: tokens['--line'],
      lineStrong: tokens['--line-strong'],
      accent: tokens['--accent'],
      accentWash: tokens['--accent-wash'],
      good,
      bad,
    },
  })
}

const THEMES: { name: string; theme: ThemeInput }[] = [
  { name: 'default-light', theme: defaultTheme('light') },
  { name: 'default-dark', theme: defaultTheme('dark') },
  ...BUILTIN_THEME_IDS.map((id) => ({ name: id, theme: themeFromTokens(id) })),
]

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

type Lab = [number, number, number]

function labOf(hex: Hex): Lab {
  const { l, c, h } = toOklch(hex)
  const rad = (h * Math.PI) / 180
  return [l, c * Math.cos(rad), c * Math.sin(rad)]
}

const deltaE = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// sRGB bytes to OKLab, for tiles of 65 000 texels.
const LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})
function tileStats(rgba: Uint8ClampedArray): { mean: Lab; lsd: number } {
  const n = rgba.length / 4
  let sl = 0
  let sa = 0
  let sb = 0
  let sll = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const r = LINEAR[rgba[i]]
    const g = LINEAR[rgba[i + 1]]
    const b = LINEAR[rgba[i + 2]]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    sl += L
    sll += L * L
    sa += 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    sb += 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
  const meanL = sl / n
  return { mean: [meanL, sa / n, sb / n], lsd: Math.sqrt(Math.max(0, sll / n - meanL * meanL)) }
}

// ---------------------------------------------------------------------------
// The values swept
// ---------------------------------------------------------------------------

const round = (x: number, places = 4): number => Number(x.toFixed(places))

function colourValues(lightness: number, chroma: number): string[] {
  return Array.from({ length: STEPS }, (_, i) => fromOklch({ l: lightness, c: chroma, h: (i * 360) / STEPS }))
}

function valuesOf(spec: GuideEntry, lightness: number, chroma: number): (number | string)[] {
  switch (spec.type) {
    case 'choice':
      return [...(spec.choices ?? [])]
    case 'colour':
      return colourValues(lightness, chroma)
    case 'number': {
      const min = spec.min ?? 0
      const max = spec.max ?? 1
      if (spec.integer === true) {
        if (max - min + 1 <= STEPS) return Array.from({ length: max - min + 1 }, (_, i) => min + i)
        return [...new Set(Array.from({ length: STEPS }, (_, i) => Math.round(min + ((max - min) * i) / (STEPS - 1))))]
      }
      return Array.from({ length: STEPS }, (_, i) => Math.min(max, Math.max(min, round(min + ((max - min) * i) / (STEPS - 1)))))
    }
    case 'curve':
      return [...CURVE_SHAPES]
  }
}

// ---------------------------------------------------------------------------
// Figures: SVG to points and colours
// ---------------------------------------------------------------------------

// The SVG without its paper layer (a figure's own backdrop belongs to the backgrounds group) and its defs.
function stripBalanced(svg: string, open: RegExp): string {
  let out = svg
  for (;;) {
    const start = out.search(open)
    if (start < 0) return out
    let depth = 0
    let end = start
    const tags = /<(\/?)g\b[^>]*?(\/?)>/g
    tags.lastIndex = start
    for (let m = tags.exec(out); m !== null; m = tags.exec(out)) {
      if (m[2] === '/') continue
      depth += m[1] === '/' ? -1 : 1
      if (depth === 0) {
        end = tags.lastIndex
        break
      }
    }
    if (end === start) return out
    out = out.slice(0, start) + out.slice(end)
  }
}

function figurePart(svg: string, paper: boolean): string {
  if (paper) {
    const start = svg.search(/<g data-layer="paper"/)
    if (start < 0) return ''
    const rest = svg.slice(start)
    const kept = stripBalanced(rest.replace(/<g data-layer="paper"/, '<g data-keep="paper"'), /<g data-layer=/)
    return kept
  }
  return stripBalanced(svg.replace(/<defs>[\s\S]*?<\/defs>/, ''), /<g data-layer="paper"/)
}

const attrOf = (tag: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1]

type Point = [number, number]

// Points along a path's d, one about every 2 px: curves are flattened, arcs taken as their chord.
function pathPoints(d: string, out: Point[]): void {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const num = (): number => Number(tokens[i++])
  const line = (nx: number, ny: number): void => {
    const length = Math.hypot(nx - x, ny - y)
    const n = Math.max(1, Math.min(400, Math.ceil(length / 2)))
    for (let k = 1; k <= n; k++) out.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n])
    x = nx
    y = ny
  }
  const bezier = (pts: Point[]): void => {
    const p0: Point = [x, y]
    const all = [p0, ...pts]
    const n = 12
    for (let k = 1; k <= n; k++) {
      const t = k / n
      let work = all.map((p) => [...p] as Point)
      for (let level = all.length - 1; level > 0; level--) {
        work = work.slice(0, level).map((p, j) => [p[0] + (work[j + 1][0] - p[0]) * t, p[1] + (work[j + 1][1] - p[1]) * t] as Point)
      }
      out.push(work[0])
    }
    const last = pts[pts.length - 1]
    x = last[0]
    y = last[1]
  }
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = num() + ox
        y = num() + oy
        sx = x
        sy = y
        out.push([x, y])
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'L':
        line(num() + ox, num() + oy)
        break
      case 'H':
        line(num() + ox, y)
        break
      case 'V':
        line(x, num() + oy)
        break
      case 'C': {
        const a: Point = [num() + ox, num() + oy]
        const b: Point = [num() + ox, num() + oy]
        const c: Point = [num() + ox, num() + oy]
        bezier([a, b, c])
        break
      }
      case 'S': {
        const b: Point = [num() + ox, num() + oy]
        const c: Point = [num() + ox, num() + oy]
        bezier([[x, y], b, c])
        break
      }
      case 'Q': {
        const a: Point = [num() + ox, num() + oy]
        const b: Point = [num() + ox, num() + oy]
        bezier([a, b])
        break
      }
      case 'T':
        line(num() + ox, num() + oy)
        break
      case 'A': {
        i += 5
        line(num() + ox, num() + oy)
        break
      }
      case 'Z':
        line(sx, sy)
        break
      default:
        i++
    }
  }
}

// How wide a label's letters run, per em, by the first family named: an estimate (there is no font to measure), enough
// to see a face change the width of a label.
function glyphWidth(family: string | undefined): number {
  const first = (family ?? '').replace(/&apos;/g, '').split(',')[0].trim()
  if (/caveat|patrick|segoe print|comic/i.test(first)) return 0.4
  if (/stix|cambria|latin modern|times|serif/i.test(first)) return 0.48
  return 0.55
}

// The points a drawing is made of: path points (strokes), and for a label points along its baseline (labels), the width (the width
// estimated from its text, font size and face), carried through the rotate() groups around it (a lettering tilt).
interface Drawing {
  strokes: Point[]
  labels: Point[]
}
function pointsOf(svg: string): Drawing {
  const out: Point[] = []
  const labels: Point[] = []
  const rotations: ([number, number, number] | null)[] = []
  const turn = (p: Point): Point => {
    let [x, y] = p
    for (let k = rotations.length - 1; k >= 0; k--) {
      const r = rotations[k]
      if (r === null) continue
      const a = (r[0] * Math.PI) / 180
      const dx = x - r[1]
      const dy = y - r[2]
      x = r[1] + dx * Math.cos(a) - dy * Math.sin(a)
      y = r[2] + dx * Math.sin(a) + dy * Math.cos(a)
    }
    return [x, y]
  }
  for (const m of svg.matchAll(/<(\/?)(g|path|line|polyline|polygon|circle|ellipse|text)\b([^>]*?)(\/?)>([^<]*)/g)) {
    const [, closing, name, tag, selfClosing, inner] = m
    if (name === 'g') {
      if (closing === '/') rotations.pop()
      else if (selfClosing !== '/') {
        const r = /rotate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(attrOf(tag, 'transform') ?? '')
        rotations.push(r === null ? null : [Number(r[1]), Number(r[2]), Number(r[3])])
      }
      continue
    }
    if (closing === '/') continue
    const mark = out.length
    const labelMark = labels.length
    const num = (attr: string): number => Number(attrOf(tag, attr) ?? 0)
    switch (name) {
      case 'path':
        pathPoints(attrOf(tag, 'd') ?? '', out)
        break
      case 'line':
        pathPoints(`M ${num('x1')} ${num('y1')} L ${num('x2')} ${num('y2')}`, out)
        break
      case 'polyline':
      case 'polygon': {
        const flat = (attrOf(tag, 'points') ?? '').trim().split(/[\s,]+/).map(Number)
        const pairs = flat.map((_, k) => (k % 2 === 0 ? `${flat[k]} ${flat[k + 1]}` : '')).filter(Boolean)
        if (pairs.length > 0) pathPoints(`M ${pairs.join(' L ')}${name === 'polygon' ? ' Z' : ''}`, out)
        break
      }
      case 'circle':
      case 'ellipse': {
        const rx = name === 'circle' ? num('r') : num('rx')
        const ry = name === 'circle' ? num('r') : num('ry')
        const n = Math.max(8, Math.min(120, Math.ceil((Math.PI * (rx + ry)) / 2)))
        for (let k = 0; k < n; k++) out.push([num('cx') + rx * Math.cos((2 * Math.PI * k) / n), num('cy') + ry * Math.sin((2 * Math.PI * k) / n)])
        break
      }
      case 'text': {
        const half = (inner.length * num('font-size') * glyphWidth(attrOf(tag, 'font-family'))) / 2
        // 21 points along the baseline.
        for (let k = 0; k <= 20; k++) labels.push([num('x') - half + (half * 2 * k) / 20, num('y')])
        break
      }
    }
    if (rotations.some((r) => r !== null)) {
      for (let k = mark; k < out.length; k++) out[k] = turn(out[k])
      for (let k = labelMark; k < labels.length; k++) labels[k] = turn(labels[k])
    }
  }
  return { strokes: out, labels }
}

// The mean distance, in px, from each sampled point of `a` to the nearest point of `b` and the other way round
// (the symmetric mean), each distance capped at 40 px so one stray stroke cannot swamp the rest. 0 for the same
// drawing, and it does not depend on how the strokes are cut into elements.
const CAP = 40
function displacement(a: Point[], b: Point[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0 || b.length === 0) return CAP
  const cell = 8
  const grid = (pts: Point[]): Map<string, Point[]> => {
    const g = new Map<string, Point[]>()
    for (const p of pts) {
      const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`
      const list = g.get(key)
      if (list === undefined) g.set(key, [p])
      else list.push(p)
    }
    return g
  }
  const oneWay = (from: Point[], to: Map<string, Point[]>): number => {
    const reach = Math.ceil(CAP / cell)
    let sum = 0
    for (const p of from) {
      const cx = Math.floor(p[0] / cell)
      const cy = Math.floor(p[1] / cell)
      let best = CAP
      // Rings of cells outward from the point's own, stopping once no farther cell can hold a nearer point.
      for (let ring = 0; ring <= reach && best > (ring - 1) * cell; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
            const list = to.get(`${cx + dx},${cy + dy}`)
            if (list === undefined) continue
            for (const q of list) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]))
          }
        }
      }
      sum += best
    }
    return sum / from.length
  }
  return (oneWay(a, grid(b)) + oneWay(b, grid(a))) / 2
}

// The share of a stroke a grain filter leaves, by the filter's id. The filter is feTurbulence noise through a colour matrix
// whose alpha row is gain*noise + bias, composited "in" the stroke: what is left is clamp(gain*n + bias, 0, 1). The noise
// is taken as uniform over 0..1 (an estimate), so the share is that mean.
function grainCoverage(svg: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of svg.matchAll(/<filter id="([^"]+)"[^>]*>([\s\S]*?)<\/filter>/g)) {
    const values = /<feColorMatrix[^>]*values="([^"]+)"/.exec(m[2])?.[1].split(/\s+/).map(Number)
    if (values === undefined || values.length !== 20) continue
    const gain = values[15]
    const bias = values[19]
    let sum = 0
    for (let k = 0; k < 200; k++) sum += Math.min(1, Math.max(0, gain * ((k + 0.5) / 200) + bias))
    out.set(m[1], sum / 200)
  }
  return out
}

// The colour each drawn element lays, as seen over the paper: its fill and stroke at their opacities, and those
// of the groups around it.
function coloursOf(svg: string, surface: Hex, coverage: ReadonlyMap<string, number>): Lab[] {
  const out: Lab[] = []
  const opacities: number[] = []
  const product = (): number => opacities.reduce((a, b) => a * b, 1)
  const colourOf = (value: string | undefined): Hex | null => {
    if (value === undefined || value === 'none' || value.startsWith('url(')) return null
    const hex = normaliseHex(value)
    if (hex !== null) return hex
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
    if (rgb === null) return null
    return '#' + [rgb[1], rgb[2], rgb[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')
  }
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, attrs, selfClosing] = m
    if (name === 'g') {
      if (closing === '/') opacities.pop()
      else if (selfClosing !== '/') {
        // A grain filter keeps the share of each stroke its speckle covers: its opacity is that share.
        const filter = /url\(#([^)]+)\)/.exec(attrOf(attrs, 'filter') ?? '')?.[1]
        opacities.push(Number(attrOf(attrs, 'opacity') ?? 1) * (filter === undefined ? 1 : (coverage.get(filter) ?? 1)))
      }
      continue
    }
    if (closing === '/' || !['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text'].includes(name)) continue
    const own = Number(attrOf(attrs, 'opacity') ?? 1)
    for (const [attr, opacityAttr] of [
      ['fill', 'fill-opacity'],
      ['stroke', 'stroke-opacity'],
    ] as const) {
      const hex = colourOf(attrOf(attrs, attr))
      if (hex === null) continue
      const alpha = product() * own * Number(attrOf(attrs, opacityAttr) ?? 1)
      out.push(labOf(blendOver(hex, surface, alpha)))
    }
  }
  return out
}

// The mean distance of each colour of `a` to the nearest colour of `b`, and back (the symmetric mean). Roughly:
// how far the picture's colours moved, however many elements carry them.
function colourShift(a: Lab[], b: Lab[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0 || b.length === 0) return 1
  // Distinct colours only, so a thousand hatch strokes do not slow the search.
  const distinct = (list: Lab[]): Lab[] => [...new Map(list.map((p) => [p.map((v) => v.toFixed(4)).join(), p] as const)).values()]
  const da = distinct(a)
  const db = distinct(b)
  const weightedOneWay = (from: Lab[], fromDistinct: Lab[], toDistinct: Lab[]): number => {
    const count = new Map<string, number>()
    for (const p of from) {
      const k = p.map((v) => v.toFixed(4)).join()
      count.set(k, (count.get(k) ?? 0) + 1)
    }
    let sum = 0
    for (const p of fromDistinct) sum += (count.get(p.map((v) => v.toFixed(4)).join()) ?? 0) * Math.min(...toDistinct.map((q) => deltaE(p, q)))
    return sum / from.length
  }
  return (weightedOneWay(a, da, db) + weightedOneWay(b, db, da)) / 2
}

// The ruled lines of a paper, laid out as the pattern repeats them over a 480 px window: the paper's rulings are
// one cell of lines in a <pattern>, tiled by the page.
const WINDOW = 480
function rulingPoints(svg: string): Point[] {
  const pattern = /<pattern[^>]*paper-rules[^>]*>([\s\S]*?)<\/pattern>/.exec(svg)
  if (pattern === null) return []
  const width = Number(attrOf(pattern[0], 'width'))
  const height = Number(attrOf(pattern[0], 'height'))
  const cell = pointsOf(pattern[1]).strokes
  const out: Point[] = []
  for (let ox = 0; ox < WINDOW; ox += width) {
    for (let oy = 0; oy < WINDOW; oy += height) for (const [x, y] of cell) out.push([x + ox, y + oy])
  }
  return out.filter(([x, y]) => x <= WINDOW && y <= WINDOW)
}

// An svg with the ids a figure makes for itself (a hash of its style) made the same, so two drawings compare by what is in them.
const sameIds = (svg: string): string => svg.replace(/\bf[0-9a-z]{4,9}-/g, 'f-')

function countElements(svg: string): number {
  return (svg.match(/<(path|line|polyline|polygon|circle|ellipse|rect|text|image)\b/g) ?? []).length
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const SPECS = FIGURE_FIXTURES.map((label) => {
  const example = EXAMPLES.find((e) => e.label === label)
  if (example === undefined) throw new Error(`no example "${label}"`)
  return example.spec
})

function renderWith(directives: readonly string[], spec: string): string {
  const parsed = parseSpec([...directives, spec].join('\n'))
  const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, undefined, defaultTheme('light'))
  const errors = [...parsed.errors, ...result.errors]
  if (errors.length > 0) throw new Error(`${directives.join(' / ')}: ${errors.map((e) => e.message).join('; ')}`)
  return result.svg
}

// A directive's value: a colour is written without its "#" (which starts a comment in a spec).
const setLine = (path: string, value: number | string): string => `@style-set: ${path} ${typeof value === 'string' ? value.replace(/^#/, '') : value}`

interface Measured {
  change: number[]
  detail: Record<string, number[]>
  measure: SweepMeasure
}

const PAPER_SURFACE: Hex = '#ffffff'

function sweepFigureSetting(spec: GuideEntry, values: (number | string)[]): Measured {
  // geometry[look][value], colour[look][value], ratio[look][value]: each the mean over the three figures.
  const geometry: number[][] = []
  const colour: number[][] = []
  const ratio: number[][] = []
  const changed: number[][] = []
  for (const look of LOOKS) {
    const base = [`@style: ${look}`]
    const geo = values.map(() => 0)
    const col = values.map(() => 0)
    const rat = values.map(() => 0)
    const chg = values.map(() => 0)
    for (const figure of SPECS) {
      const reference = renderWith([...base, setLine(spec.path, spec.default as number | string)], figure)
      const refDrawing = pointsOf(figurePart(reference, false))
      const refColours = coloursOf(figurePart(reference, false), PAPER_SURFACE, grainCoverage(reference))
      const refCount = countElements(figurePart(reference, false))
      values.forEach((value, v) => {
        const svg = renderWith([...base, setLine(spec.path, value)], figure)
        const part = figurePart(svg, false)
        const drawing = pointsOf(part)
        // A label moved is as plain to see as a stroke moved, and there are far fewer of its points: the larger of the two.
        geo[v] += Math.max(displacement(drawing.strokes, refDrawing.strokes), displacement(drawing.labels, refDrawing.labels)) / SPECS.length
        col[v] += colourShift(coloursOf(part, PAPER_SURFACE, grainCoverage(svg)), refColours) / SPECS.length
        // 1 when the markup differs from the default's at all (a font, a filter, a transform: what neither
        // measure sees).
        if (sameIds(part) !== sameIds(figurePart(reference, false))) chg[v] = 1
        rat[v] += countElements(part) / Math.max(1, refCount) / SPECS.length
      })
    }
    geometry.push(geo)
    colour.push(col)
    ratio.push(rat)
    changed.push(chg)
  }
  const worst = (rows: number[][]): number[] => values.map((_, v) => Math.max(...rows.map((row) => row[v])))
  const displacementPx = worst(geometry)
  const colourDE = worst(colour)
  // Geometry when the setting moves points at all (the 'none' edge, 0.1 px); colour otherwise.
  const measure: SweepMeasure = Math.max(...displacementPx) >= 0.1 ? 'geometry' : 'colour'
  return {
    measure,
    change: measure === 'geometry' ? displacementPx : colourDE,
    detail: {
      displacementPx,
      colourDeltaE: colourDE,
      markupChanged: worst(changed),
      elementRatio: values.map((_, v) => ratio.reduce((sum, row) => sum + row[v], 0) / ratio.length),
    },
  }
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function sweepMediumSetting(spec: GuideEntry, values: (number | string)[]): Measured {
  const [, name, key] = spec.path.split('.')
  const medium = MEDIA[name as keyof typeof MEDIA]
  const at = (theme: ThemeInput, value: number | undefined): Lab[] =>
    ROLE_KEYS.map((role) => {
      const drawn = medium.colour(theme, { key: role }, value === undefined ? {} : { [key]: value })
      return labOf(blendOver(drawn.hex, medium.surfaceColour(theme), drawn.opacity))
    })
  const references = THEMES.map(({ theme }) => at(theme, undefined))
  const change: number[] = []
  const p95: number[] = []
  for (const value of values) {
    const diffs: number[] = []
    THEMES.forEach(({ theme }, t) => at(theme, value as number).forEach((lab, r) => diffs.push(deltaE(lab, references[t][r]))))
    change.push(diffs.reduce((a, b) => a + b, 0) / diffs.length)
    const sorted = [...diffs].sort((a, b) => a - b)
    p95.push(sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))])
  }
  return { measure: 'colour', change, detail: { p95DeltaE: p95 } }
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

// The generated paper behind each paper type; null is a flat sheet (none, clean).
const GENERATED_OF: Record<string, GeneratedPaperType | null> = {
  none: null,
  clean: null,
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

interface Paper {
  type: string
  tint: 'theme' | string
  texture: number
  size: number
}

// A paper's tile as the figure would bake it (tilePixels on the paper's key): its mean colour and L spread, for
// one theme. A flat sheet is its colour alone.
function paperStats(paper: Paper, theme: ThemeInput): { mean: Lab; lsd: number } {
  const tint = paper.tint === 'theme' ? theme.colours.paper : paper.tint
  const generated = GENERATED_OF[paper.type]
  if (generated === null || generated === undefined) return { mean: labOf(tint), lsd: 0 }
  const base = paperBaseColour(generated, theme, tint)
  const tile = tilePixels(paperKey(generated, 0, paper.size, paper.texture, base.toLowerCase()))
  if (tile === null) throw new Error(`no tile for ${paper.type}`)
  return tileStats(tile.rgba)
}

// What a background setting changes, against the default, averaged over the 6 themes. The headline is the larger
// of the tile's mean-colour shift (OKLab dE) and its change in L spread, both in OKLab units: grain moves the
// spread long before it moves the mean.
function sweepTiles(values: (number | string)[], make: (value: number | string | undefined, theme: ThemeInput) => { mean: Lab; lsd: number }): Measured {
  const references = THEMES.map(({ theme }) => make(undefined, theme))
  const shift: number[] = []
  const spread: number[] = []
  for (const value of values) {
    let de = 0
    let sd = 0
    THEMES.forEach(({ theme }, t) => {
      const got = make(value, theme)
      de += deltaE(got.mean, references[t].mean) / THEMES.length
      sd += Math.abs(got.lsd - references[t].lsd) / THEMES.length
    })
    shift.push(de)
    spread.push(sd)
  }
  return { measure: 'colour', change: shift.map((de, i) => Math.max(de, spread[i])), detail: { meanDeltaE: shift, lSdChange: spread } }
}

const PAPER_DEFAULT: Paper = { type: 'clean', tint: 'theme', texture: 0, size: 512 }

function sweepBackground(spec: GuideEntry, values: (number | string)[]): Measured {
  const path = spec.path
  if (path === 'style.paper.grid') {
    // The rulings are lines in the figure's SVG, not part of the tile: measured as the displacement of the lines
    // of a graph paper behind a figure, against the default spacing.
    const rulings = (grid: number): Point[] => rulingPoints(renderWith(['@style-set: style.paper.type graph', setLine(path, grid)], SPECS[0]))
    const reference = rulings(spec.default as number)
    const change = values.map((value) => displacement(rulings(value as number), reference))
    return { measure: 'geometry', change, detail: { rulingCount: values.map((value) => rulings(value as number).length) } }
  }
  if (path.startsWith('board.')) {
    const options = (value: number | undefined): Parameters<typeof deriveBoards>[1] =>
      path === 'board.tilt' ? (value === undefined ? {} : { tilt: value }) : value === undefined ? {} : { chromaCap: { [path.split('.')[1]]: value } }
    const names: readonly BoardName[] = path === 'board.tilt' ? BOARD_NAMES : [path.split('.')[1] as BoardName]
    // The board's tile, in the board's colour for the theme, read at the board's own settings.
    const stats = (theme: ThemeInput, value: number | undefined): { mean: Lab; lsd: number } => {
      const boards = deriveBoards(theme.boardColours.accent, options(value))
      const each = names.map((name) => tileStats(tilePixels(paperKey(name, 0, TILE, 1, boards[name].toLowerCase()))!.rgba))
      return { mean: [0, 1, 2].map((k) => each.reduce((s, e) => s + e.mean[k], 0) / each.length) as Lab, lsd: each.reduce((s, e) => s + e.lsd, 0) / each.length }
    }
    return sweepTiles(values, (value, theme) => stats(theme, value as number | undefined))
  }
  // style.paper.type / tint / texture / tile: each in a context where it is read.
  const context: Paper =
    path === 'style.paper.type'
      ? { ...PAPER_DEFAULT, texture: 0.6, size: TILE }
      : { type: 'paper', tint: 'theme', texture: 0.6, size: TILE }
  const defaultPaper: Paper =
    path === 'style.paper.type'
      ? context
      : path === 'style.paper.texture'
        ? { ...context, texture: 0 }
        : path === 'style.paper.tile'
          ? { ...context, size: 512 }
          : context
  const field = path.split('.')[2] as 'type' | 'tint' | 'texture' | 'tile'
  const change = (paper: Paper, value: number | string): Paper =>
    field === 'type' ? { ...paper, type: value as string } : field === 'tint' ? { ...paper, tint: value as string } : field === 'texture' ? { ...paper, texture: value as number } : { ...paper, size: value as number }
  const swept = path === 'style.paper.type' ? { ...context, type: PAPER_DEFAULT.type } : defaultPaper
  return sweepTiles(values, (value, theme) => paperStats(value === undefined ? swept : change(context, value), theme))
}

// ---------------------------------------------------------------------------
// Paint (the per-frame painter only: paintFrame, never the bake)
// ---------------------------------------------------------------------------

const CURVE_SHAPES = ['identity', 'raised', 'lowered'] as const
// How far 'raised' and 'lowered' bend the default curve: each point's y moved by this share of the editor's y range.
const CURVE_BEND = 0.15

// The three views of the sphere-on-table fixture (space/paint/model/valueFinalFixture.ts): a camera at 30/25; a grazing
// camera at 200/2 (a long cast shadow, a lit and a shadow side); a nearer camera from above at 120/40 (the strokes larger
// on screen). Each is lit as the painter's own light parameters say (light.azimuth, elevation and worldFixed, as the
// lab's keyLightDirection turns them into the view's lightDir), so the light settings move the picture. A frame is
// PAINT_W x PAINT_H css px (the fixture's own is 640x480; the smaller frame keeps the sweep inside its time budget).
const PAINT_W = 400
const PAINT_H = 300
const PAINT_VIEWS: { name: string; opts: Parameters<typeof viewOf>[0]; zoom: number }[] = [
  { name: 'sphere-on-table, camera 30/25', opts: { azimuth: 30, elevation: 25 }, zoom: 75 },
  { name: 'sphere-on-table, grazing camera 200/2', opts: { azimuth: 200, elevation: 2 }, zoom: 75 },
  { name: 'sphere-on-table, closer camera 120/40', opts: { azimuth: 120, elevation: 40 }, zoom: 130 },
]
const PAINT_COLOURS = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: CANVAS, 2: lchToLab(0.4, 0.05, 55) })

const paintViewCache = new Map<string, PaintView>()
// The view lit by the parameters' light: a world-fixed light (worldFixed 0.5 or more) is the direction at its azimuth and
// elevation about z; a camera-relative one is the camera's own (azimuth + = to the viewer's left).
function paintViewOf(params: PaintParams, vi: number): PaintView {
  const key = JSON.stringify([vi, params.light])
  let view = paintViewCache.get(key)
  if (!view) {
    const v = PAINT_VIEWS[vi]
    const { azimuth, elevation, worldFixed } = params.light
    view = viewOf(worldFixed >= 0.5 ? { ...v.opts, light: [azimuth, elevation] } : { ...v.opts, lightAzimuth: azimuth, lightElevation: elevation }, [PAINT_W, PAINT_H, v.zoom])
    paintViewCache.set(key, view)
  }
  return view
}
const paintSets = new Map<string, ParticleSet>()
const paintGBuffers = new Map<string, GBuffer>()

function paintFrameOf(params: PaintParams, vi: number): PaintFrame {
  const view = paintViewOf(params, vi)
  const gkey = JSON.stringify([vi, params.light])
  let g = paintGBuffers.get(gkey)
  if (!g) {
    g = sphereGBuffer(PAINT_W, PAINT_H, { view, params, table: { z: -1, mark: 1 } })
    paintGBuffers.set(gkey, g)
  }
  const pkey = JSON.stringify([params.seed, params.particles])
  let set = paintSets.get(pkey)
  if (!set) {
    if (paintSets.size >= 6) paintSets.clear()
    set = buildParticles(SCENE, PAINT_COLOURS, params)
    paintSets.set(pkey, set)
  }
  return paintFrame(SCENE, set, view, g, params)
}

// A frame as the metrics read it: each stroke's role, colour (OKLab), geometry (mean width, path length, path points) and a
// key naming its particle (role, the stroke's seed and where its path starts in the world), the stroke count of each role,
// and the edge-class shares of the frame's edge segments.
interface Reading {
  keys: string[]
  role: Uint8Array
  lab: Float64Array
  width: Float64Array // mean width of each stroke, css px
  length: Float64Array // path length of each stroke, css px
  path: Float32Array // PATH_POINTS points per stroke, css px
  count: number
  byRole: number[]
  edgeShare: number[]
}

function reading(frame: PaintFrame): Reading {
  const b = frame.strokes
  const keys: string[] = new Array(b.count)
  const lab = new Float64Array(3 * b.count)
  const width = new Float64Array(b.count)
  const length = new Float64Array(b.count)
  const seen = new Map<string, number>()
  const stride = b.worldPath.length / Math.max(1, b.count) // 3 * PATH_POINTS
  const byRole = new Array<number>(ROLES.length).fill(0)
  for (let i = 0; i < b.count; i++) {
    const o = stride * i
    const base = `${b.role[i]}|${b.seed[i]}|${Math.round(b.worldPath[o] * 200)}|${Math.round(b.worldPath[o + 1] * 200)}|${Math.round(b.worldPath[o + 2] * 200)}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    keys[i] = `${base}#${n}`
    byRole[b.role[i]]++
    const [l, a, bb] = linearToOklab(b.colour[3 * i], b.colour[3 * i + 1], b.colour[3 * i + 2])
    lab[3 * i] = l
    lab[3 * i + 1] = a
    lab[3 * i + 2] = bb
    let w = 0
    let len = 0
    for (let k = 0; k < PATH_POINTS; k++) {
      w += b.width[PATH_POINTS * i + k]
      if (k > 0) len += Math.hypot(b.path[2 * (PATH_POINTS * i + k)] - b.path[2 * (PATH_POINTS * i + k - 1)], b.path[2 * (PATH_POINTS * i + k) + 1] - b.path[2 * (PATH_POINTS * i + k - 1) + 1])
    }
    width[i] = w / PATH_POINTS
    length[i] = len
  }
  const hist = new Array<number>(EDGE_CLASSES.length).fill(0)
  const ec = frame.debug.edgeClass
  for (let i = 0; i < ec.length; i++) if (ec[i] < hist.length) hist[ec[i]]++
  const total = hist.reduce((x, y) => x + y, 0)
  return { keys, role: b.role, lab, width, length, path: b.path, count: b.count, byRole, edgeShare: hist.map((h) => (total > 0 ? h / total : 0)) }
}

const dE = (a: Float64Array, i: number, b: Float64Array, j: number): number => Math.hypot(a[3 * i] - b[3 * j], a[3 * i + 1] - b[3 * j + 1], a[3 * i + 2] - b[3 * j + 2])

// What one view of a changed frame differs by, against the default frame.
interface ViewChange {
  colour: number // the largest over roles of the role's mean dE
  geometry: number // the largest over roles of the role's larger of mean width, length and path-point change, px
  structure: number // the largest over roles of |stroke count / default's - 1|
  edges: number // L1 distance between the edge-class shares
  p95: number // 95th percentile of the dE over all strokes
  lShift: number // signed change of the mean L of all strokes
  ratio: number // stroke count over the default's
}

function compareFrames(r: Reading, d: Reading): ViewChange {
  // Pair each stroke with the default's of the same particle and role. When the particles themselves moved (a seed, a cell
  // size: under half the strokes find a partner) the pairs are made by role and by rank of lightness instead, which
  // compares the colour distributions role by role; strokes so paired are not the same stroke, so their geometry is
  // compared as role means (width and length only).
  const index = new Map<string, number>()
  d.keys.forEach((k, i) => index.set(k, i))
  let pairs: [number, number][] = []
  for (let i = 0; i < r.count; i++) {
    const j = index.get(r.keys[i])
    if (j !== undefined) pairs.push([i, j])
  }
  const matched = pairs.length >= 0.5 * Math.min(r.count, d.count)
  if (!matched) {
    pairs = []
    for (let role = 0; role < ROLES.length; role++) {
      const a = [...Array(r.count).keys()].filter((i) => r.role[i] === role).sort((x, y) => r.lab[3 * x] - r.lab[3 * y] || x - y)
      const b = [...Array(d.count).keys()].filter((i) => d.role[i] === role).sort((x, y) => d.lab[3 * x] - d.lab[3 * y] || x - y)
      const n = Math.min(a.length, b.length)
      for (let k = 0; k < n; k++) pairs.push([a[Math.floor((k * a.length) / n)], b[Math.floor((k * b.length) / n)]])
    }
  }
  const dEs: number[] = []
  const colourSum = new Array<number>(ROLES.length).fill(0)
  const widthSum = new Array<number>(ROLES.length).fill(0)
  const lengthSum = new Array<number>(ROLES.length).fill(0)
  const moveSum = new Array<number>(ROLES.length).fill(0)
  const pairN = new Array<number>(ROLES.length).fill(0)
  for (const [i, j] of pairs) {
    const role = r.role[i]
    const e = dE(r.lab, i, d.lab, j)
    dEs.push(e)
    colourSum[role] += e
    pairN[role]++
    if (matched) {
      widthSum[role] += Math.abs(r.width[i] - d.width[j])
      lengthSum[role] += Math.abs(r.length[i] - d.length[j])
      let move = 0
      for (let k = 0; k < PATH_POINTS; k++) move += Math.hypot(r.path[2 * (PATH_POINTS * i + k)] - d.path[2 * (PATH_POINTS * j + k)], r.path[2 * (PATH_POINTS * i + k) + 1] - d.path[2 * (PATH_POINTS * j + k) + 1])
      moveSum[role] += move / PATH_POINTS
    }
  }
  let colour = 0
  let geometry = 0
  let structure = 0
  for (let role = 0; role < ROLES.length; role++) {
    if (pairN[role] > 0) {
      colour = Math.max(colour, colourSum[role] / pairN[role])
      if (matched) geometry = Math.max(geometry, widthSum[role] / pairN[role], lengthSum[role] / pairN[role], moveSum[role] / pairN[role])
    }
    // (a role with no strokes in the default frame: each stroke it gains counts as a whole stroke)
    structure = Math.max(structure, Math.abs(r.byRole[role] - d.byRole[role]) / Math.max(1, d.byRole[role]))
  }
  if (!matched) {
    for (let role = 0; role < ROLES.length; role++) {
      const a = [...Array(r.count).keys()].filter((i) => r.role[i] === role)
      const b = [...Array(d.count).keys()].filter((i) => d.role[i] === role)
      if (a.length > 0 && b.length > 0) geometry = Math.max(geometry, Math.abs(meanOf(a.map((i) => r.width[i])) - meanOf(b.map((i) => d.width[i]))), Math.abs(meanOf(a.map((i) => r.length[i])) - meanOf(b.map((i) => d.length[i]))))
    }
  }
  return {
    colour,
    geometry,
    structure,
    edges: r.edgeShare.reduce((s, x, k) => s + Math.abs(x - d.edgeShare[k]), 0),
    p95: percentile(dEs, 0.95),
    lShift: meanL(r) - meanL(d),
    ratio: d.count === 0 ? 1 : r.count / d.count,
  }
}

const meanOf = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]
}
function meanL(r: Reading): number {
  let s = 0
  for (let i = 0; i < r.count; i++) s += r.lab[3 * i]
  return r.count === 0 ? 0 : s / r.count
}

// The curve shapes: identity is the straight line between the default's end points, raised and lowered move every
// point of the default curve up or down by CURVE_BEND of the editor's y range (clamped to it).
function curveShape(spec: GuideEntry, shape: string): number[][] {
  const points = spec.default as number[][]
  const lo = spec.min ?? 0
  const hi = spec.max ?? 1
  const clamp = (y: number): number => Math.min(hi, Math.max(lo, y))
  if (shape === 'identity') {
    const first = points[0]
    const last = points[points.length - 1]
    return points.map(([x]) => [x, clamp(first[1] + ((x - first[0]) / (last[0] - first[0])) * (last[1] - first[1]))])
  }
  const sign = shape === 'raised' ? 1 : -1
  return points.map(([x, y]) => [x, clamp(y + sign * CURVE_BEND * (hi - lo))])
}

const RANK = { none: 0, subtle: 1, moderate: 2, strong: 3 } as const

// The four dimensions of a paint entry, each as its measure and the headline numbers per value. The entry takes the one
// whose largest change over the values rates strongest (a tie goes to the larger change as a share of the moderate edge,
// then to the order below); `measure` names it and all four go in `detail`.
function sweepPaintSetting(spec: GuideEntry, values: (number | string)[]): Measured {
  const dims = {
    colour: { measure: 'colour' as SweepMeasure, change: [] as number[] },
    geometry: { measure: 'geometry' as SweepMeasure, change: [] as number[] },
    structure: { measure: 'structure' as SweepMeasure, change: [] as number[] },
    edges: { measure: 'structure' as SweepMeasure, change: [] as number[] },
  }
  const other = { p95DeltaE: [] as number[], meanLShift: [] as number[], strokeRatio: [] as number[] }
  const base = PAINT_VIEWS.map((_, vi) => reading(paintFrameOf(toPaintParams(new Map()), vi)))
  for (const value of values) {
    const set = new Map<string, number | string | number[][]>([[spec.path, spec.type === 'curve' ? curveShape(spec, value as string) : value]])
    const params = toPaintParams(set)
    const views = PAINT_VIEWS.map((_, vi) => compareFrames(reading(paintFrameOf(params, vi)), base[vi]))
    dims.colour.change.push(meanOf(views.map((v) => v.colour)))
    dims.geometry.change.push(meanOf(views.map((v) => v.geometry)))
    dims.structure.change.push(meanOf(views.map((v) => v.structure)))
    dims.edges.change.push(meanOf(views.map((v) => v.edges)))
    other.p95DeltaE.push(meanOf(views.map((v) => v.p95)))
    other.meanLShift.push(meanOf(views.map((v) => v.lShift)))
    other.strokeRatio.push(meanOf(views.map((v) => v.ratio)))
  }
  let winner: keyof typeof dims = 'colour'
  let best = -1
  for (const name of ['colour', 'geometry', 'structure', 'edges'] as const) {
    const d = dims[name]
    const top = Math.max(0, ...d.change)
    const score = RANK[rate(d.measure, top)] * 1000 + Math.min(999, top / EDGES[d.measure][2])
    if (score > best) {
      best = score
      winner = name
    }
  }
  return {
    change: dims[winner].change,
    measure: dims[winner].measure,
    detail: {
      colourRoleDeltaE: dims.colour.change,
      geometryPx: dims.geometry.change,
      structureShare: dims.structure.change,
      edgeClassL1: dims.edges.change,
      ...other,
    },
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function engineOf(path: string): SweepEngine | null {
  if (path.startsWith('paint.')) return 'paint'
  if (path.startsWith('media.')) return 'media'
  if (path.startsWith('board.') || path.startsWith('style.paper.')) return 'backgrounds'
  if (path.startsWith('style.')) return 'figures'
  throw new Error(`no engine for ${path}`)
}

// The one place a rating is decided: not-drawn-yet, then render-only (the shader reads it; the model's numbers stay), else measured.
function ratingOf(path: string, notDrawn: boolean, measure: SweepMeasure, change: number[]): SweepRating {
  if (notDrawn) return 'not-drawn-yet'
  if (isRenderOnly(path)) return 'render-only'
  return rate(measure, Math.max(0, ...change))
}

function entryOf(spec: GuideEntry): SweepEntry {
  const engine = engineOf(spec.path)!
  const lightness = spec.path === 'style.paper.tint' ? Math.min(0.93, toOklch(defaultTheme('light').colours.paper).l) : toOklch(defaultTheme('light').colours.ink).l
  const values = valuesOf(spec, lightness, spec.path === 'style.paper.tint' ? 0.05 : 0.1)
  const measured = engine === 'paint' ? sweepPaintSetting(spec, values) : engine === 'figures' ? sweepFigureSetting(spec, values) : engine === 'media' ? sweepMediumSetting(spec, values) : sweepBackground(spec, values)
  const change = measured.change.map((x) => round(x, 6))
  const active = activeRange(values, change)
  const notDrawn = spec.meaning.startsWith('Not drawn yet:')
  return {
    path: spec.path,
    engine,
    measure: measured.measure,
    values,
    change,
    rating: ratingOf(spec.path, notDrawn, measured.measure, change),
    activeRange: active,
    saturates: saturates(change),
    detail: Object.fromEntries(Object.entries(measured.detail).map(([k, list]) => [k, list.map((x) => round(x, 6))])),
  }
}

const NOTE =
  'Measured by tools/settings-sweep.mts (figures, media, backgrounds); each setting is swept over 9 evenly spaced values (all the values of an integer or a choice when there are fewer, 9 hues at the default\'s lightness for a colour), and its change is measured against the setting at its registry default. ' +
  'Figures: three examples drawn through renderFigure under four looks (ink, pencil, marker, blackboard), the setting written with @style-set; the change is the largest over the looks of the mean over the examples. ' +
  'Measure: geometry when the setting moves path points by 0.1 px or more at any value (mean px distance from each sampled point to the nearest point of the default drawing, both ways, each capped at 40 px; the paper layer is left out; labels are measured apart, as points along the baseline with the glyph width estimated from the face, and the larger of the two counts), otherwise colour (OKLab dE of the drawn fill and stroke colours over a white page, at their opacities, a grain filter taken as the share of a stroke its speckle leaves, the noise assumed uniform). detail.markupChanged marks the values at which the markup differs from the default at all. ' +
  'Media: mean OKLab dE of each role colour (13 roles, over its own surface) across the 6 themes. ' +
  'Backgrounds: the 256 px tile as the figure bakes it (tilePixels), averaged over the 6 themes; the headline is the larger of the mean colour shift (dE) and the change in the tile\'s L standard deviation (grain moves the spread before the mean); style.paper.grid is the displacement of the rulings (geometry) on a graph paper; board.* are the board colours derived from each theme\'s accent. ' +
  'Not-drawn-yet settings are measured like the rest and rated not-drawn-yet.'

const PAINT_MARK = ' Paint: '
const PAINT_NOTE =
  PAINT_MARK +
  `the per-frame painter only (paintFrame, never the bake), on the sphere-on-table fixture (valueFinalFixture.ts) in ${PAINT_VIEWS.length} views at ${PAINT_W}x${PAINT_H} css px (smaller than the fixture's 640x480, to keep the run inside its time budget); each setting is applied with toPaintParams to a stack with that one setting changed and the frame is compared with the default frame, averaged over the views. ` +
  'A paint entry is rated on the STRONGEST of four dimensions, each the largest over the stroke roles (so a change to one role is not diluted by the rest), and `measure` names the one that won (a tie goes to the larger change as a share of the moderate edge). ' +
  'colour: the role\'s mean OKLab dE of the stroke colours, each stroke matched to the stroke of the same particle and role in the default frame (role, stroke seed and where its path starts in the world; thresholds as colour). ' +
  'geometry: for the matched strokes, the role\'s mean change in px of stroke width, of path length and of path-point displacement, the largest of the three (geometry thresholds). ' +
  'structure: the role\'s |stroke count over the default\'s - 1| (none under 0.02, subtle under 0.1, moderate under 0.3). ' +
  'edges: the L1 distance between the shares of the edge segments in the four edge classes (the structure thresholds, measure structure). ' +
  'When under half the strokes find a partner (the particles themselves moved: seed, cell size) the strokes are paired by role and by rank of lightness for colour, and geometry is the change of the role means of width and length. ' +
  'detail holds all four (colourRoleDeltaE, geometryPx, structureShare, edgeClassL1) and p95DeltaE (95th percentile of the dE over all strokes), meanLShift (signed change of the mean OKLab L of all strokes), strokeRatio (stroke count over the default\'s, all roles). ' +
  'A curve is swept over 3 shapes: identity (the straight line between the end points of the default curve), raised and lowered (every point of the default curve moved up or down by ' +
  `${CURVE_BEND * 100}% of the editor's y range, clamped to it).`

// The header's note: a full run writes it whole; an --only run keeps the existing one, with its paint part (the text from
// PAINT_MARK on) replaced when this run measured paint.
function noteOf(only: string | undefined, existing: SweepFile | null): string {
  if (only === undefined || existing === null) return NOTE + PAINT_NOTE
  const old = existing.header.note
  if (!'paint.'.startsWith(only) && !only.startsWith('paint.')) return old
  const at = old.indexOf(PAINT_MARK)
  return (at < 0 ? old : old.slice(0, at)) + PAINT_NOTE
}

// --relabel: re-apply the ratings to the existing sweep.json from its stored numbers, through ratingOf, without measuring.
function relabel(): void {
  if (!existsSync(OUT)) throw new Error(`${OUT} is missing; nothing to relabel`)
  const file = JSON.parse(readFileSync(OUT, 'utf8')) as SweepFile
  const notDrawn = new Map(GUIDE.map((spec) => [spec.path, spec.meaning.startsWith('Not drawn yet:')]))
  let changed = 0
  for (const entry of file.entries) {
    const rating = ratingOf(entry.path, notDrawn.get(entry.path) ?? entry.rating === 'not-drawn-yet', entry.measure, entry.change)
    if (rating !== entry.rating) changed++
    entry.rating = rating
  }
  writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n')
  console.log(`relabelled ${OUT}: ${changed} of ${file.entries.length} ratings changed`)
}

function main(): void {
  const started = Date.now()
  const args = process.argv.slice(2)
  if (args.includes('--relabel')) return relabel()
  const onlyAt = args.indexOf('--only')
  const only = onlyAt >= 0 ? args[onlyAt + 1] : undefined
  if (onlyAt >= 0 && (only === undefined || only.startsWith('--'))) throw new Error('--only needs a path prefix')

  const specs = GUIDE.filter((spec) => engineOf(spec.path) !== null)
  const chosen = specs.filter((spec) => only === undefined || spec.path.startsWith(only))
  if (chosen.length === 0) throw new Error(`nothing to sweep for the prefix "${only}"`)
  const fresh = chosen.map((spec) => {
    const t = Date.now()
    const entry = entryOf(spec)
    console.log(`${spec.path.padEnd(40)} ${entry.engine.padEnd(11)} ${entry.measure.padEnd(8)} ${entry.rating.padEnd(14)} max ${Math.max(...entry.change).toFixed(4)}  ${Date.now() - t} ms`)
    return entry
  })

  const existing: SweepFile | null = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as SweepFile) : null
  const mine = (path: string): boolean => engineOf(path) !== null
  // Keep what this run did not re-measure: with --only the other entries; without it the paint entries.
  const kept = (existing?.entries ?? []).filter((entry) => (only === undefined ? !mine(entry.path) : !entry.path.startsWith(only)))
  const entries = [...kept, ...fresh].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const header: SweepFile['header'] = {
    fixtures: {
      ...(existing?.header.fixtures ?? {}),
      ...(chosen.some((spec) => engineOf(spec.path) === 'paint') ? { paint: PAINT_VIEWS.map((v) => `${v.name} (${PAINT_W}x${PAINT_H})`) } : {}),
      figures: [...FIGURE_FIXTURES],
      media: [...ROLE_KEYS],
      backgrounds: [`a ${TILE} px tile, seed 0`, `${FIGURE_FIXTURES[0]} on a graph paper (grid)`],
    },
    themes: THEMES.map((t) => t.name),
    steps: STEPS,
    note: noteOf(only, existing),
  }
  const file: SweepFile = { header, entries }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n')

  const covered = new Set(entries.map((e) => e.path))
  const missing = specs.filter((s) => !covered.has(s.path)).map((s) => s.path)
  if (only === undefined && missing.length > 0) throw new Error(`no entry for ${missing.join(', ')}`)
  console.log(`wrote ${OUT}: ${entries.length} entries (${fresh.length} measured) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  const tally: Record<string, number> = {}
  for (const entry of fresh) tally[entry.rating] = (tally[entry.rating] ?? 0) + 1
  console.log('ratings', JSON.stringify(tally))
}

main()
