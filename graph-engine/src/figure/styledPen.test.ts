import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { resolveColor } from '../parser/colors'
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../render/palette'
import { EXAMPLES } from '../examples'
import { toOklch } from '../style/color'
import { MEDIA } from '../style/media'
import { defaultTheme, fromColours } from '../style/theme/adapter'
import { contrastRatio, drawnContrast } from '../style/theme/contrast'
import type { MediumName, ThemeInput } from '../style/theme/types'
import { cssColor } from './document'
import { estimateTextSize, LABEL_FONT_SIZE } from './labels'
import { renderFigure } from './render'

// The styled pen, end to end: a spec with a style directive renders through
// renderFigure, deterministically, keeping every element's identity.

const TRIANGLE = [
  '@mode: figure',
  'A = (0, 0)',
  'B = (6, 0)',
  'C = (1, 4)',
  'segment: A-B',
  'segment: B-C',
  'segment: C-A',
  'circle: (3, 1.5), 1',
  'angle: B-A-C',
  'tick: A-C',
  'label: AB',
].join('\n')

const render = (spec: string) => {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

// The angle between two hues, in degrees (0 to 180), and the OKLCH hue of a colour name.
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
const hueOfName = (name: string) => toOklch(cssColor(resolveColor(name))).h

// Every drawn element inside one of the figure's layers, with its tag and
// its identity attributes.
function elements(svg: string, layers: readonly string[]): { tag: string; statement: string | null; object: string | null }[] {
  const out: { tag: string; statement: string | null; object: string | null }[] = []
  for (const name of layers) {
    const open = svg.indexOf(`<g data-layer="${name}"`)
    if (open < 0) continue
    const start = svg.indexOf('>', open) + 1
    if (svg[start - 2] === '/') continue
    // Layers hold no nested groups except a label's tilt group, so the
    // matching close is the first `</g>` at depth zero.
    let depth = 0
    let i = start
    for (; i < svg.length; i++) {
      if (svg.startsWith('<g', i) && svg[i + 2] !== 'r') depth++
      else if (svg.startsWith('</g>', i)) {
        if (depth === 0) break
        depth--
      }
    }
    const inner = svg.slice(start, i)
    for (const match of inner.matchAll(/<(path|line|polyline|polygon|circle|ellipse|text|rect)\b([^>]*)>/g)) {
      out.push({
        tag: match[1],
        statement: /data-statement="([^"]*)"/.exec(match[2])?.[1] ?? null,
        object: /data-object="([^"]*)"/.exec(match[2])?.[1] ?? null,
      })
    }
  }
  return out
}

const GEOMETRY = ['regions', 'auxiliary', 'primary', 'marks', 'points']

describe('a styled figure', () => {
  for (const preset of ['ink', 'pencil', 'marker']) {
    describe(preset, () => {
      const spec = `@style: ${preset}\n${TRIANGLE}`

      it('renders without errors, and not as clean', () => {
        const result = render(spec)
        expect(result.errors).toEqual([])
        expect(result.svg).not.toBe(render(TRIANGLE).svg)
        expect(result.svg).not.toMatch(/NaN|Infinity|undefined/)
      })

      it('is deterministic', () => {
        expect(render(spec).svg).toBe(render(spec).svg)
      })

      it('keeps every element’s statement and object', () => {
        const styled = elements(render(spec).svg, GEOMETRY)
        expect(styled.length).toBeGreaterThan(0)
        for (const element of styled) expect(element.statement, element.tag).not.toBeNull()
        const identities = (list: typeof styled) => [...new Set(list.map((e) => `${e.statement}/${e.object}`))].sort()
        expect(identities(styled)).toEqual(identities(elements(render(TRIANGLE).svg, GEOMETRY)))
      })
    })
  }

  it('changes with the seed, and only then', () => {
    const ink = render(`@style: ink\n${TRIANGLE}`).svg
    expect(render(`@style: ink\n@style-seed: 0\n${TRIANGLE}`).svg).toBe(ink)
    expect(render(`@style: ink\n@style-seed: 1\n${TRIANGLE}`).svg).not.toBe(ink)
  })

  it('is clean again, byte for byte, when the style says clean', () => {
    expect(render(`@style: clean\n${TRIANGLE}`).svg).toBe(render(TRIANGLE).svg)
  })

  // Randomness is keyed by identity, statement included: two congruent
  // segments in different statements must not share one wobble.
  it('gives congruent strokes of different statements different wobble', () => {
    const svg = render(['@style: ink', '@mode: figure', 'P = (0, 0)', 'Q = (4, 0)', 'R = (0, 3)', 'S = (4, 3)', 'segment: P-Q', 'segment: R-S'].join('\n')).svg
    const shapeOf = (statement: number) => {
      const polygon = new RegExp(`<polygon points="([^"]*)"[^>]*data-statement="${statement}"`).exec(svg)
      expect(polygon, `statement ${statement}`).not.toBeNull()
      const points = polygon![1].split(' ').map((pair) => pair.split(',').map(Number))
      const [x0, y0] = points[0]
      // Relative to its own first point, so two strokes a translation apart
      // compare equal when their wobble is the same.
      return points.map(([x, y]) => `${(x - x0).toFixed(1)},${(y - y0).toFixed(1)}`).join(' ')
    }
    expect(shapeOf(4)).not.toBe(shapeOf(5))
  })

  it('defines its textures once, with ids from the figure’s content', () => {
    const pencil = render(`@style: pencil\n${TRIANGLE}`).svg
    const ids = [...pencil.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(pencil).toContain(`url(#${id})`)
    // Another figure in the same style names its textures differently, so two
    // figures on one page cannot collide.
    const other = render(`@style: pencil\n${TRIANGLE.replace('C = (1, 4)', 'C = (2, 5)')}`).svg
    const otherIds = [...other.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1])
    for (const id of otherIds) expect(ids).not.toContain(id)
  })
})

// Fills: every filled item draws its marks inside a clip of its EXACT outline
// (the very path the clean pen fills), so hatching, stipple and scribble
// never spill over an edge or into a hole.
describe('a styled fill', () => {
  const example = (label: string) => EXAMPLES.find((e) => e.label === label)!.spec

  // The clip paths of a figure, by id, and the groups clipped to each.
  const clips = (svg: string) => [...svg.matchAll(/<clipPath id="([^"]+)">(<[^>]+>)<\/clipPath>/g)].map((m) => ({ id: m[1], outline: m[2] }))
  const clippedGroups = (svg: string, id: string) => [...svg.matchAll(new RegExp(`<g clip-path="url\\(#${id}\\)"([^>]*)>`, 'g'))].map((m) => m[1])
  const d = (element: string) => / d="([^"]*)"/.exec(element)?.[1] ?? /points="([^"]*)"/.exec(element)?.[1]

  for (const type of ['hatch', 'crosshatch', 'stipple', 'scribble', 'wash']) {
    it(`${type} clips its marks to the region's exact outline`, () => {
      const spec = example('Square minus its circle')
      const clean = render(spec).svg
      // Roughness 0: this is about the clip mechanism, not the off-register
      // shift roughness adds on top of it (fills/wash.ts, fills/flat.ts).
      const styled = render(`@style: ink
@style-fill: ${type}
@style-roughness: 0
${spec}`).svg
      const found = clips(styled)
      expect(found).toHaveLength(1)
      // The clip IS the region's exact outline: the clean fill's own path.
      const cleanRegion = /<g data-layer="regions">(<path[^>]*>)/.exec(clean)![1]
      expect(d(found[0].outline)).toBe(d(cleanRegion))
      expect(found[0].outline).toContain('clip-rule="evenodd"')
      const groups = clippedGroups(styled, found[0].id)
      expect(groups).toHaveLength(1)
      expect(groups[0]).toContain('data-statement=')
    })
  }

  it('keeps the annulus’s hole out of every fill: the clip carries the hole', () => {
    for (const type of ['hatch', 'stipple', 'scribble', 'wash', 'crosshatch']) {
      const styled = render(`@style: pencil
@style-fill: ${type}
${example('Annulus')}`).svg
      const [clip] = clips(styled)
      expect(clip.outline, type).toContain('clip-rule="evenodd"')
      // Two loops: the outer circle and the hole.
      expect(d(clip.outline)!.match(/M /g), type).toHaveLength(2)
    }
  })

  it('reaches sectors, segments and cut faces as well as shaded regions', () => {
    for (const label of ['Circle vocabulary', 'Secant and chord', 'Cross-section (cut)']) {
      const styled = render(`@style: ink
@style-fill: hatch
${example(label)}`).svg
      expect(clips(styled).length, label).toBeGreaterThan(0)
    }
  })

  it('draws flat and none without a clip', () => {
    for (const type of ['flat', 'none']) {
      // Roughness 0: at roughness > 0, flat's off-register shift needs its
      // own clip (fills/flat.ts) — a deliberate exception, tested below.
      expect(clips(render(`@style: ink
@style-fill: ${type}
@style-roughness: 0
${example('Square minus its circle')}`).svg), type).toHaveLength(0)
    }
  })

  it('flat gets its own clip once roughness gives it an off-register shift', () => {
    const styled = render(`@style: ink
@style-fill: flat
@style-roughness: 1
${example('Square minus its circle')}`).svg
    expect(clips(styled)).toHaveLength(1)
  })

  // Review round 1, test gap: a shifted flat fill on a region with a hole
  // (not just the plain square above) still clips to the exact outline,
  // hole included.
  it('a shifted flat fill on the annulus clips to its exact outline, hole and all', () => {
    const styled = render(`@style: ink
@style-fill: flat
@style-roughness: 1
${example('Annulus')}`).svg
    const found = clips(styled)
    expect(found).toHaveLength(1)
    expect(found[0].outline).toContain('clip-rule="evenodd"')
    // Two loops: the outer circle and the hole.
    expect(d(found[0].outline)!.match(/M /g)).toHaveLength(2)
  })

  it('is deterministic', () => {
    const spec = `@style: marker
${example('Lens of two circles')}`
    expect(render(spec).svg).toBe(render(spec).svg)
  })
})

// Papers, lettering and colour, end to end.
describe('a styled page', () => {
  const texts = (svg: string) =>
    [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((m) => ({
      text: m[2],
      x: /\bx="([^"]*)"/.exec(m[1])![1],
      y: /\by="([^"]*)"/.exec(m[1])![1],
      family: /font-family="([^"]*)"/.exec(m[1])?.[1],
    }))
  const LABELLED = EXAMPLES.find((e) => e.label === 'Measured + notation')!.spec

  // A face and a tilt never move a label: at the clean size, every label is
  // written exactly where clean writes it.
  it('writes labels in the handwriting stack, at exactly their clean anchors', () => {
    const clean = texts(render(LABELLED).svg)
    const hand = texts(render(`@style: pencil\n@style-lettering-size: 1\n@style-tilt: 1\n${LABELLED}`).svg)
    expect(hand.length).toBe(clean.length)
    for (const label of hand) expect(label.family).toMatch(/^Caveat/)
    expect(hand.map(({ text, x, y }) => `${text}@${x},${y}`).sort()).toEqual(clean.map(({ text, x, y }) => `${text}@${x},${y}`).sort())
  })

  // A lettering SIZE is laid out, not just drawn (review 1): labels are
  // placed at the size they are written, so a big hand keeps its labels
  // apart.
  it('lays labels out at the size it letters them', () => {
    for (const label of ['Solids on points', 'AIME: a fly on a cone', 'Cube and its net']) {
      const spec = EXAMPLES.find((e) => e.label === label)!.spec
      const svg = render(`@style: pencil\n@style-lettering-size: 1.6\n@style-tilt: 0\n${spec}`).svg
      const boxes = [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)]
        .filter((m) => m[1].includes('text-anchor="middle"'))
        .map((m) => {
          const size = Number(/font-size="([^"]*)"/.exec(m[1])![1])
          const x = Number(/\bx="([^"]*)"/.exec(m[1])![1])
          const y = Number(/\by="([^"]*)"/.exec(m[1])![1])
          const { width, height } = estimateTextSize(m[2], size)
          return { size, x0: x - width / 2, x1: x + width / 2, y0: y - height / 2, y1: y + height / 2, text: m[2] }
        })
      expect(boxes.length, label).toBeGreaterThan(2)
      for (const box of boxes) expect(box.size, label).toBeCloseTo(LABEL_FONT_SIZE * 1.6, 9)
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
          expect(overlap, `${label}: "${a.text}" and "${b.text}"`).toBe(false)
        }
      }
    }
  })

  it('tilts each label about its own anchor, by at most four degrees', () => {
    const svg = render(`@style: pencil\n@style-tilt: 1\n${LABELLED}`).svg
    const rotations = [...svg.matchAll(/<g transform="rotate\(([^ ]+) ([^ ]+) ([^)]+)\)"[^>]*>(<text[^>]*>)/g)]
    expect(rotations.length).toBeGreaterThanOrEqual(3)
    for (const [, degrees, cx, cy, text] of rotations) {
      expect(Math.abs(Number(degrees))).toBeLessThanOrEqual(4)
      // A plain label is written centred on its anchor, so it turns about it.
      if (text.includes('text-anchor="middle"')) {
        expect(cx).toBe(/\bx="([^"]*)"/.exec(text)![1])
        expect(cy).toBe(/\by="([^"]*)"/.exec(text)![1])
      }
    }
    expect(render(`@style: pencil\n@style-tilt: 0\n${LABELLED}`).svg).not.toMatch(/rotate\(/)
  })

  it('applies saturation to ink, fills, paper and an author’s own colour', () => {
    // Named colours: "#" starts a comment in a spec.
    const figure = ['@mode: figure', 'polygon: A(0,0), B(4,0), C(1,3) color: red', 'fill: A-B-C color: blue', 'segment: A-C']
    const spec = ['@style: ink', '@style-fill: flat', '@style-saturation: 0', ...figure].join('\n')
    const svg = render(spec).svg
    const colours = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(colours.length).toBeGreaterThan(3)
    for (const hex of colours) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b), hex).toBeLessThanOrEqual(1)
    }
    // At 1 the author's colours are what the ink medium makes of them (it fits each to its own
    // range and to the paper, and leaves its hue): not grey, and still red and blue.
    const vivid = render(spec.replace('@style-saturation: 0', '@style-saturation: 1')).svg
    // Ink draws every line as a filled outline, so the polygon's colour is a fill.
    const polygon = /<polygon[^>]*fill="(#[0-9a-f]{6})"[^>]*data-statement="0"/.exec(vivid)![1]
    const region = /<path[^>]*fill="(#[0-9a-f]{6})"[^>]*data-statement="1"/.exec(vivid)![1]
    for (const [hex, named] of [[polygon, 'red'], [region, 'blue']] as const) {
      expect(toOklch(hex).c, `${named} ${hex}`).toBeGreaterThan(0.03)
      expect(hueGap(toOklch(hex).h, hueOfName(named)), `${named} ${hex}`).toBeLessThanOrEqual(25)
    }
  })

  it('lays the paper under everything, generously', () => {
    const svg = render(`@style: ink\n@style-paper: graph\n${TRIANGLE}`).svg
    const paper = svg.indexOf('data-layer="paper"')
    expect(paper).toBeGreaterThan(0)
    expect(paper).toBeLessThan(svg.indexOf('data-layer="regions"'))
    expect(svg).toMatch(/<pattern id="[^"]+graph"/)
  })

  it('lays no paper at all for none', () => {
    const svg = render(`@style: ink\n@style-paper: none\n${TRIANGLE}`).svg
    expect(svg).not.toMatch(/data-layer="paper"/)
  })
})

// Review 1: an author can ask for the finest spacing over the whole figure.
// Each region has a mark budget (style/fills/region.ts), so the reviewer's
// worst cases — which were 3 to 4.5 MB — stay under a megabyte.
describe('the mark budget', () => {
  const SQUARE = '@mode: figure\npolygon: A(0,0), B(4,0), C(4,4), D(0,4)\nfill: A-B-C-D'
  const DISK = '@mode: figure\nM = (0, 0)\nO = circle M, 2\nfill: circle O'
  const CASES: [string, string][] = [
    ['chalk crosshatch on a square', `@style: pencil\n@style-line: chalk\n@style-fill: crosshatch\n@style-fill-spacing: 3\n${SQUARE}`],
    ['chalk crosshatch on a disk', `@style: pencil\n@style-line: chalk\n@style-fill: crosshatch\n@style-fill-spacing: 3\n${DISK}`],
    ['ink stipple on a square', `@style: ink\n@style-fill: stipple\n@style-fill-spacing: 3\n${SQUARE}`],
    ['pencil, three passes, crosshatch', `@style: pencil\n@style-passes: 3\n@style-fill: crosshatch\n@style-fill-spacing: 3\n${SQUARE}`],
    ['ink scribble on a square', `@style: ink\n@style-fill: scribble\n@style-fill-spacing: 3\n${SQUARE}`],
  ]

  for (const [name, spec] of CASES) {
    it(`keeps ${name} at spacing 3 under a megabyte`, () => {
      const result = render(spec)
      expect(result.errors).toEqual([])
      expect(result.svg.length, name).toBeLessThan(1024 * 1024)
    })
  }
})

// Review 1: technical is clean's line. Clean with one other setting changed
// keeps clean's line ends and its native dashes, element for element.
describe('clean with one setting changed', () => {
  const ends = (svg: string) =>
    elements(svg, ['auxiliary', 'primary', 'marks']).length > 0
      ? [...svg.slice(svg.indexOf('data-layer="regions"')).matchAll(/<(line|path|polyline|circle)\b([^>]*)>/g)]
          .filter((m) => /\bstroke="#/.test(m[2]))
          .map((m) => `${/stroke-linecap="([^"]*)"/.exec(m[2])?.[1] ?? '-'} ${/stroke-dasharray="([^"]*)"/.exec(m[2])?.[1] ?? '-'}`)
          .sort()
      : []

  for (const label of ['Constructions', 'Cylinder and cone', 'Solved triangle']) {
    it(`keeps every line end and dash of ${label}`, () => {
      const spec = EXAMPLES.find((e) => e.label === label)!.spec
      const clean = ends(render(spec).svg)
      const graph = ends(render(`@style-paper: graph\n${spec}`).svg)
      expect(clean.length).toBeGreaterThan(3)
      expect(graph).toEqual(clean)
      expect(clean.some((e) => e.endsWith('9 7'))).toBe(true)
    })
  }
})

// Review 1, rulings 8 and 10.
describe('a styled figure in its host', () => {
  // Read from disk: vitest hands a stylesheet import back empty.
  const CSS = readFileSync(new URL('../FigureView.css', import.meta.url), 'utf8') as string

  it('marks its root so the view scales every stroke with the zoom; clean is unmarked', () => {
    expect(render(`@style: pencil\n${TRIANGLE}`).svg).toMatch(/^<svg [^>]*data-style="pencil"/)
    expect(render(TRIANGLE).svg).not.toMatch(/data-style/)
    // The non-scaling rule is scoped to unmarked (clean) figures.
    expect(CSS).toMatch(/svg:not\(\[data-style\]\) \[data-layer\] \*\s*\{\s*vector-effect: non-scaling-stroke;/)
    expect(CSS).not.toMatch(/\.figure-view-surface svg \[data-layer\] \*/)
  })

  const figure = (head: string, palette: typeof LIGHT_PALETTE) => {
    const parsed = parseSpec(`${head}\n@mode: figure\npolygon: A(0,0), B(4,0), C(1,3) color: black\nfill: A-B-C color: blue\nsegment: A-C`)
    return renderFigure(parsed.statements, parsed.config, palette).svg
  }

  // The ink, pencil and marker follow the theme through their medium. They used to lay an off-white
  // paper in either theme and draw the same figure in both; now a dark theme is a dark paper, with
  // a medium's own light ink on it, and an author's "black" comes out in it too, legible on its paper.
  it('follows the theme through its medium: a dark theme is a dark paper and a light ink', () => {
    const paperOf = (svg: string) => /<g data-layer="paper"><rect[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)![1]
    const blackOf = (svg: string) => /<(?:polygon|path)[^>]*(?:fill|stroke)="(#[0-9a-f]{6})"[^>]*data-statement="0"/.exec(svg)![1]
    for (const preset of ['ink', 'pencil', 'marker']) {
      const light = figure(`@style: ${preset}`, LIGHT_PALETTE)
      const dark = figure(`@style: ${preset}`, DARK_PALETTE)
      expect(dark, preset).not.toBe(light)
      expect(toOklch(paperOf(light)).l, preset).toBeGreaterThan(0.8)
      expect(toOklch(paperOf(dark)).l, preset).toBeLessThan(0.3)
      expect(contrastRatio(blackOf(light), paperOf(light)), `${preset} in light`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(blackOf(dark), paperOf(dark)), `${preset} in dark`).toBeGreaterThanOrEqual(3)
    }
  })

  it('follows the host theme when its paper does', () => {
    for (const paper of ['@style-paper: none', '@style-tint: theme']) {
      expect(figure(`@style: ink\n${paper}`, DARK_PALETTE), paper).not.toBe(figure(`@style: ink\n${paper}`, LIGHT_PALETTE))
    }
  })
})

// ---------------------------------------------------------------------------
// The medium: every role a figure draws takes its colour from the style's medium
// ---------------------------------------------------------------------------

describe('a figure in a medium', () => {
  // A construction that draws every role: a line, an auxiliary (dashed) line, a measure, a label, a
  // point, a mark (the right angle), the givens table, a fill, and an author's own colours (a red
  // segment, a blue polygon, a green fill).
  const FIGURE = [
    '@mode: figure',
    '@angle: degrees',
    '@givens: right',
    'triangle ABC: angle A = 90, AB = 6, AC = 8',
    'D = foot A to B-C',
    'segment: A-D dashed',
    'right-angle: B-A-C',
    'segment: B-C color: red',
    'polygon: P(11,0), Q(14,0), R(12,3) color: blue',
    'fill: P-Q-R color: green',
    'label: AB = 6',
    'given: AB = 6',
    'find: BC',
  ].join('\n')
  const LINE = ['@mode: figure', 'A = (0, 0)', 'B = (4, 0)', 'segment: A-B'].join('\n')
  const RED = `${LINE} color: red`

  const draw = (head: string, options: { palette?: Palette; theme?: ThemeInput; body?: string } = {}): string => {
    const parsed = parseSpec(`${head}\n${options.body ?? FIGURE}`)
    expect(parsed.errors).toEqual([])
    const result = renderFigure(parsed.statements, parsed.config, options.palette ?? LIGHT_PALETTE, undefined, options.theme)
    expect(result.errors).toEqual([])
    return result.svg
  }

  // One layer's markup, the colours in it, and the colour of the paper under everything.
  const layerOf = (svg: string, name: string): string => {
    const start = svg.indexOf(`<g data-layer="${name}"`)
    const next = svg.indexOf('<g data-layer="', start + 1)
    return svg.slice(start, next < 0 ? undefined : next)
  }
  const coloursIn = (markup: string): string[] => [...new Set([...markup.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1]))]
  const paperOf = (svg: string) => /<g data-layer="paper"><rect[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)![1]
  const LAYERS = ['regions', 'auxiliary', 'primary', 'marks', 'points', 'labels'] as const
  const palette = (mode: 'light' | 'dark') => (mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)

  // On a board, everything that is drawn is chalk: light, and legible against the board.
  for (const board of ['blackboard', 'greenboard'] as const) {
    for (const mode of ['light', 'dark'] as const) {
      it(`draws every role on a ${board} in light chalk that reads against it, in ${mode}`, () => {
        const theme = defaultTheme(mode)
        const svg = draw(`@style: ${board}`, { palette: palette(mode), theme })
        const surface = theme.boards[board]
        expect(paperOf(svg)).toBe(surface)
        for (const layer of LAYERS) {
          const found = coloursIn(layerOf(svg, layer)).filter((hex) => hex !== surface)
          expect(found.length, layer).toBeGreaterThan(0)
          for (const hex of found) {
            expect(toOklch(hex).l, `${layer} ${hex}`).toBeGreaterThanOrEqual(0.75)
            expect(contrastRatio(hex, surface), `${layer} ${hex}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      })
    }
  }

  it('draws every role on a whiteboard in a dark marker that reads against the board', () => {
    const theme = defaultTheme('light')
    const svg = draw('@style: whiteboard', { theme })
    const surface = theme.boards.whiteboard
    expect(paperOf(svg)).toBe(surface)
    for (const layer of LAYERS) {
      const found = coloursIn(layerOf(svg, layer)).filter((hex) => hex !== surface)
      expect(found.length, layer).toBeGreaterThan(0)
      for (const hex of found) {
        expect(toOklch(hex).l, `${layer} ${hex}`).toBeLessThanOrEqual(0.6)
        expect(contrastRatio(hex, surface), `${layer} ${hex}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  // The media's floors hold for the figure as drawn, in either mode: a stroke of each role at the
  // medium's opacity keeps its contrast with its paper.
  const FLOORS: [string, MediumName, number][] = [
    ['ink', 'ink', 7],
    ['pencil', 'graphite', 4.5],
    ['colouredPencil', 'colouredPencil', 3],
    ['marker', 'marker', 3],
  ]
  for (const [preset, medium, floor] of FLOORS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`keeps the ${medium} medium's contrast with its paper, in ${mode}`, () => {
        const theme = defaultTheme(mode)
        const svg = draw(`@style: ${preset}`, { palette: palette(mode), theme })
        const paper = paperOf(svg)
        const opacity = MEDIA[medium].colour(theme, { key: 'line' }, {}).opacity
        // Lines, points and labels: the layers a reader has to read. (Fills are a tint, laid thin.)
        for (const layer of ['auxiliary', 'primary', 'marks', 'points', 'labels'] as const) {
          for (const hex of coloursIn(layerOf(svg, layer)).filter((colour) => colour !== paper)) {
            expect(drawnContrast(hex, paper, opacity), `${preset} ${layer} ${hex}`).toBeGreaterThanOrEqual(floor - 0.1)
          }
        }
      })
    }
  }

  // An author's own colour is a base colour like any other: the medium fits it.
  it('draws an author’s own colour on a blackboard as a pastel chalk colour of the same hue', () => {
    const svg = draw('@style: blackboard', { body: RED })
    const board = paperOf(svg)
    const found = coloursIn(layerOf(svg, 'primary')).filter((hex) => hex !== board)
    expect(found).toHaveLength(1)
    const { l, c, h } = toOklch(found[0])
    expect(l).toBeGreaterThanOrEqual(0.8)
    expect(c).toBeGreaterThan(0.03)
    expect(hueGap(h, hueOfName('red'))).toBeLessThanOrEqual(25)
  })

  it('fits an author’s own colour to every medium, and keeps its hue', () => {
    const red = hueOfName('red')
    for (const [preset, test] of [
      ['blackboard', (l: number) => l >= 0.8],
      ['greenboard', (l: number) => l >= 0.8],
      ['whiteboard', (l: number) => l <= 0.6],
      ['ink', (l: number) => l <= 0.5],
      ['marker', (l: number) => l >= 0.4 && l <= 0.7],
    ] as const) {
      const svg = draw(`@style: ${preset}`, { body: RED })
      const board = paperOf(svg)
      const [hex] = coloursIn(layerOf(svg, 'primary')).filter((colour) => colour !== board)
      const { l, c, h } = toOklch(hex)
      expect(test(l), `${preset} ${hex}`).toBe(true)
      expect(c, `${preset} ${hex}`).toBeGreaterThan(0.03)
      expect(hueGap(h, red), `${preset} ${hex}`).toBeLessThanOrEqual(25)
    }
  })

  // A board is the same in light and in dark, and so is what is drawn on it, author's colours included.
  const C = { surface: '#f7f3ea', paper: '#f7f3ea', ink: '#1b1b2f', muted: '#66667a', accent: '#2f6fb0' }
  const D = { surface: '#14141c', paper: '#14141c', ink: '#e8e8f4', muted: '#9a9ab0', accent: '#6fa0e0' }
  for (const preset of ['blackboard', 'greenboard', 'whiteboard']) {
    it(`draws a ${preset} byte for byte the same in the light and the dark`, () => {
      // With no theme, the palette's mode picks the default theme.
      expect(draw(`@style: ${preset}`, { palette: DARK_PALETTE })).toBe(draw(`@style: ${preset}`, { palette: LIGHT_PALETTE }))
      // With the default theme of each mode.
      expect(draw(`@style: ${preset}`, { palette: DARK_PALETTE, theme: defaultTheme('dark') })).toBe(
        draw(`@style: ${preset}`, { palette: LIGHT_PALETTE, theme: defaultTheme('light') })
      )
      // With a custom theme that says what its light mode is.
      expect(draw(`@style: ${preset}`, { palette: DARK_PALETTE, theme: fromColours({ mode: 'dark', colours: D, lightColours: C }) })).toBe(
        draw(`@style: ${preset}`, { palette: LIGHT_PALETTE, theme: fromColours({ mode: 'light', colours: C }) })
      )
    })
  }

  it('draws in the default theme of its mode when it is given no theme', () => {
    for (const preset of ['ink', 'pencil', 'marker', 'colouredPencil', 'blackboard', 'greenboard', 'whiteboard']) {
      for (const mode of ['light', 'dark'] as const) {
        expect(draw(`@style: ${preset}`, { palette: palette(mode) }), `${preset} ${mode}`).toBe(draw(`@style: ${preset}`, { palette: palette(mode), theme: defaultTheme(mode) }))
      }
    }
  })

  it('draws a paper medium on the theme’s own paper, fitted to it', () => {
    const cream = fromColours({ colours: { surface: '#f2e8cf', paper: '#f2e8cf', ink: '#2b2118' } })
    const svg = draw('@style: colouredPencil', { theme: cream })
    expect(paperOf(svg)).toBe('#f2e8cf')
    const slate = fromColours({ mode: 'dark', colours: { surface: '#1d2a26', paper: '#1d2a26', ink: '#e6efe9' } })
    const dark = draw('@style: colouredPencil', { theme: slate, palette: DARK_PALETTE })
    expect(paperOf(dark)).toBe('#1d2a26')
    for (const [markup, paper] of [[svg, '#f2e8cf'], [dark, '#1d2a26']]) {
      for (const hex of coloursIn(layerOf(markup, 'primary')).filter((colour) => colour !== paper)) expect(contrastRatio(hex, paper), hex).toBeGreaterThanOrEqual(3)
    }
    expect(toOklch(coloursIn(layerOf(dark, 'primary'))[0]).l).toBeGreaterThan(toOklch(coloursIn(layerOf(svg, 'primary'))[0]).l)
  })

  // Paper and medium agree: ink drawn on a board, or on a paper tinted dark, is fitted to it, not to the theme's paper.
  it('fits a paper medium to the board or the tint it is drawn on', () => {
    const board = draw('@style: colouredPencil\n@style-paper: blackboard', { body: LINE })
    expect(paperOf(board)).toBe(defaultTheme('light').boards.blackboard)
    for (const hex of coloursIn(layerOf(board, 'primary')).filter((colour) => colour !== paperOf(board))) expect(contrastRatio(hex, paperOf(board)), hex).toBeGreaterThanOrEqual(3)
    // Ink too: its saturation moves the board a hair, and it still reads on it at ink's own bar.
    const ink = draw('@style: ink\n@style-paper: blackboard', { body: LINE })
    for (const hex of coloursIn(layerOf(ink, 'primary')).filter((colour) => colour !== paperOf(ink))) expect(contrastRatio(hex, paperOf(ink)), hex).toBeGreaterThanOrEqual(7)
    const tinted = draw('@style: colouredPencil\n@style-tint: 1d1d2b', { body: LINE })
    expect(paperOf(tinted)).toBe('#1d1d2b')
    for (const hex of coloursIn(layerOf(tinted, 'primary')).filter((colour) => colour !== paperOf(tinted))) expect(contrastRatio(hex, paperOf(tinted)), hex).toBeGreaterThanOrEqual(3)
  })

  // A medium lays a stroke at its own opacity (clean's is full, so it writes none).
  it('lays what it draws at the medium’s opacity', () => {
    for (const [preset, medium] of [['blackboard', 'chalk'], ['pencil', 'graphite'], ['whiteboard', 'whiteboard']] as const) {
      const opacity = MEDIA[medium].colour(defaultTheme('light'), { key: 'point' }, {}).opacity
      expect(opacity, medium).toBeLessThan(1)
      const svg = draw(`@style: ${preset}`)
      expect(layerOf(svg, 'points'), preset).toMatch(new RegExp(`<circle[^>]*opacity="${opacity}"`))
      expect(layerOf(svg, 'labels'), preset).toMatch(new RegExp(`<text[^>]*opacity="${opacity}"|<g opacity="${opacity}">`))
    }
    expect(layerOf(draw('@style: ink'), 'points')).not.toContain('opacity=')
  })

  // A medium's settings are settings of the stack: "@style-set" reaches the pen.
  it('reads the medium’s settings from the stack', () => {
    const colourOf = (head: string, body: string) => {
      const svg = draw(head, { body })
      return toOklch(coloursIn(layerOf(svg, 'primary')).filter((hex) => hex !== paperOf(svg))[0])
    }
    expect(colourOf('@style: blackboard\n@style-set: media.chalk.chroma 0.7', RED).c).toBeGreaterThan(colourOf('@style: blackboard\n@style-set: media.chalk.chroma 0.5', RED).c)
    expect(colourOf('@style: colouredPencil\n@style-set: media.colouredPencil.chroma 1.2', RED).c).toBeGreaterThan(colourOf('@style: colouredPencil\n@style-set: media.colouredPencil.chroma 0.4', RED).c)
    expect(colourOf('@style: pencil\n@style-set: media.graphite.hint 0.05', RED).c).toBeGreaterThan(colourOf('@style: pencil\n@style-set: media.graphite.hint 0', RED).c)
    // An ink the style names as mid grey is pulled toward the paper's opposite until it keeps the contrast asked for.
    expect(colourOf('@style: ink\n@style-ink: 808080\n@style-set: media.ink.contrast 15', LINE).l).toBeLessThan(colourOf('@style: ink\n@style-ink: 808080\n@style-set: media.ink.contrast 4.5', LINE).l)
    expect(colourOf('@style: ink\n@style-set: media.ink.chroma 1.5', RED).c).toBeGreaterThan(colourOf('@style: ink\n@style-set: media.ink.chroma 0.3', RED).c)
  })

  it('starts a medium from the ink the style names, and still fits it', () => {
    const svg = draw('@style: blackboard\n@style-ink: 2f5fd0', { body: LINE })
    const [hex] = coloursIn(layerOf(svg, 'primary')).filter((colour) => colour !== paperOf(svg))
    const { l, c, h } = toOklch(hex)
    // Chalk's lightness range starts at 0.80; the 8-bit colour lands a hair either side of it.
    expect(l).toBeGreaterThanOrEqual(0.79)
    expect(c).toBeGreaterThan(0.03)
    expect(hueGap(h, toOklch('#2f5fd0').h)).toBeLessThanOrEqual(25)
  })

  it('takes the style’s saturation on top of the medium’s colour', () => {
    const grey = draw('@style: blackboard\n@style-saturation: 0', { body: RED })
    for (const hex of coloursIn(layerOf(grey, 'primary')).filter((colour) => colour !== paperOf(grey))) expect(toOklch(hex).c, hex).toBeLessThan(0.01)
  })

  it('is deterministic, and keeps every element’s statement and object', () => {
    for (const preset of ['colouredPencil', 'blackboard', 'greenboard', 'whiteboard']) {
      const spec = `@style: ${preset}`
      expect(draw(spec)).toBe(draw(spec))
      const identities = (svg: string) => [...new Set(elements(svg, GEOMETRY).map((e) => `${e.statement}/${e.object}`))].sort()
      expect(identities(draw(spec)), preset).toEqual(identities(draw('@style: clean')))
    }
  })

  // A look in the clean medium is drawn in the host's own colours, as it always was: clean with one
  // other setting changed keeps the palette's ink exactly.
  it('leaves the clean medium to the host’s palette', () => {
    const svg = draw('@style-line: pencil', { body: LINE })
    expect(svg).toContain(`stroke="${cssColor(LIGHT_PALETTE.axis)}"`)
    expect(draw('@style-line: pencil', { body: LINE, palette: DARK_PALETTE })).toContain(`stroke="${cssColor(DARK_PALETTE.axis)}"`)
  })
})
