import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { EXAMPLES } from '../examples'
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
      const styled = render(`@style: ink
@style-fill: ${type}
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
      expect(clips(render(`@style: ink
@style-fill: ${type}
${example('Square minus its circle')}`).svg), type).toHaveLength(0)
    }
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

  it('writes labels in the handwriting stack, at exactly their clean anchors', () => {
    const clean = texts(render(LABELLED).svg)
    const hand = texts(render(`@style: pencil\n@style-tilt: 1\n${LABELLED}`).svg)
    expect(hand.length).toBe(clean.length)
    for (const label of hand) expect(label.family).toMatch(/^Caveat/)
    expect(hand.map(({ text, x, y }) => `${text}@${x},${y}`).sort()).toEqual(clean.map(({ text, x, y }) => `${text}@${x},${y}`).sort())
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
    const spec = ['@style: ink', '@style-saturation: 0', ...figure].join('\n')
    const svg = render(spec).svg
    const colours = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(colours.length).toBeGreaterThan(3)
    for (const hex of colours) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b), hex).toBeLessThanOrEqual(1)
    }
    // At 1 the author's colours stand exactly as the clean figure draws them.
    const vivid = render(spec.replace('@style-saturation: 0', '@style-saturation: 1')).svg
    const clean = render(figure.join('\n')).svg
    const polygon = /<line[^>]*stroke="(#[0-9a-f]{6})"[^>]*data-statement="0"/.exec(clean)![1]
    const region = /<path[^>]*fill="(#[0-9a-f]{6})"[^>]*data-statement="1"/.exec(clean)![1]
    expect(vivid).toContain(`stroke="${polygon}"`)
    expect(vivid).toContain(`fill="${region}"`)
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
