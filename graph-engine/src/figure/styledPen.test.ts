import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
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
