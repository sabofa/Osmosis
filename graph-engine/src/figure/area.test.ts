import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { parseStatement } from '../parser/parseStatement'
import { LIGHT_PALETTE } from '../render/palette'
import { LABEL_FONT_SIZE } from './labels'
import { layoutNotation, notationOrigin } from './notation'
import { renderFigure } from './render'

// Phase 12, task 3 — the area of a shaded region, measured and asserted
// (F3, F6). Every value is worked by hand:
//
//   square side 4 minus its inscribed circle r = 2:  16 − 4π        = 3.43363…  -> "3.434"
//   lens of two unit circles 1 apart:                2π/3 − √3/2    = 1.22837…  -> "1.228"
//
// F6's anchor, by hand. The seven lines sit at i·h/8 up the largest
// component, i = 1 … 7, and the label hangs at the midpoint of the longest
// chord inside the region, ties to the lowest line, then the leftmost chord:
//
//   annulus R = 3, r = 2 at the origin: h = 6, the lowest line is y = −2.25,
//     which misses the hole (|y| > 2) and is the longest chord of all seven,
//     2√(9 − 5.0625) ≈ 3.97 (y = −1.5 gives two chords of 1.275), so the
//     anchor is (0, −2.25) — in the ring, 2.25 from the centre.
//   square side 4 minus circle r = 2: h = 4, the lowest line is y = −1.5,
//     where the circle is at x = ±√(4 − 2.25) = ±√1.75; its two chords
//     [−2, −√1.75] and [√1.75, 2] are 0.677 long, longer than on any higher
//     line (y = −1 gives 2 − √3 = 0.268, y = 0 nothing), and y = 1.5 ties but
//     is higher; the left one wins: (−(2 + √1.75)/2, −1.5) = (−1.661, −1.5).

function rendered(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function errorsOf(spec: string): string[] {
  return rendered(spec).errors.map((e) => e.message)
}

function layer(svg: string, name: string): string {
  const selfClosing = `<g data-layer="${name}"/>`
  if (svg.includes(selfClosing)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open)
  if (start < 0) throw new Error(`no layer "${name}" in output`)
  const from = start + open.length
  return svg.slice(from, svg.indexOf('</g>', from))
}

// Every text run in the labels layer, with where it is drawn.
function texts(svg: string): { x: string; y: string; text: string }[] {
  return [...layer(svg, 'labels').matchAll(/<text x="([^"]*)" y="([^"]*)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: m[1], y: m[2], text: m[3] }))
}

// The dot a bare "(x, y)" point draws: the one naming no object.
function dot(svg: string): { x: string; y: string } {
  const found = [...layer(svg, 'points').matchAll(/<circle cx="([^"]*)" cy="([^"]*)"[^>]*\/>/g)].filter((m) => !m[0].includes('data-object'))
  if (found.length !== 1) throw new Error(`expected one bare dot, found ${found.length}`)
  return { x: found[0][1], y: found[0][2] }
}

// Whether a measure label's text is CENTRED on a point: a notation run is
// written from its left edge, half its laid-out width left of its centre.
function centredOn(label: { x: string; y: string; text: string }, at: { x: string; y: string }): boolean {
  const origin = notationOrigin(layoutNotation([{ text: label.text, mark: 'none' }], LABEL_FONT_SIZE), { x: Number(at.x), y: Number(at.y) })
  return Math.abs(Number(label.x) - origin.x) <= 0.002 && Math.abs(Number(label.y) - origin.y) <= 0.002
}

const SQUARE_AND_CIRCLE = `@mode: figure
A = (-2, -2)
B = (2, -2)
C = (2, 2)
D = (-2, 2)
M = (0, 0)
O = circle M, 2
fill: square ABCD minus circle O name: R`

describe('the grammar', () => {
  it('reads an area subject as a region: a name, or an inline expression', () => {
    expect(parseStatement('label: area R')).toMatchObject({
      kind: 'measureLabel',
      subject: { kind: 'area', region: { kind: 'named', name: 'R' } },
      content: { kind: 'computed' },
    })
    expect(parseStatement('label: area R = 3.434')).toMatchObject({ content: { kind: 'stated', value: 3.434 } })
    expect(parseStatement('given: area square ABCD minus circle O')).toMatchObject({
      kind: 'given',
      entry: { kind: 'measure', subject: { kind: 'area', region: { kind: 'combine', op: 'difference', source: 'square ABCD minus circle O' } } },
    })
    expect(parseStatement('find: area circle O and circle P')).toMatchObject({
      kind: 'given',
      section: 'find',
      entry: { subject: { kind: 'area', region: { kind: 'combine', op: 'intersection' } } },
    })
  })

  it('keeps refusing the areas it does not measure', () => {
    expect(() => parseStatement('label: S area')).toThrow(/Areas and volumes are not measured yet/)
    expect(() => parseStatement('given: area of S')).toThrow(/Areas and volumes are not measured yet/)
  })
})

describe('label: area', () => {
  it('prints the area of a named region', () => {
    const svg = rendered(`${SQUARE_AND_CIRCLE}\nlabel: area R`).svg
    expect(texts(svg).map((t) => t.text)).toContain('3.434')
  })

  // One tolerance rule for every measure assertion (fix round 1): an area
  // is checked at the shared relative GEOM_EPS exactly as a length is, so
  // the printed decimal of an irrational area does NOT assert it. 16 − 4π
  // = 16 − 12.5663706144… = 3.4336293856…
  it('asserts a stated area at the one shared tolerance: the printed 3.434 is refused, the full value holds', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nlabel: area R = 3.434`)).toEqual([
      '"area R = 3.434" disagrees with the figure — the geometry gives 3.434. Fix the construction, write "area R = x" for a symbolic value, or set "@scale: false" if the figure is deliberately not to scale.',
    ])
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nlabel: area R = 4`)).toEqual([
      '"area R = 4" disagrees with the figure — the geometry gives 3.434. Fix the construction, write "area R = x" for a symbolic value, or set "@scale: false" if the figure is deliberately not to scale.',
    ])
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nlabel: area R = 3.4336293856`)).toEqual([])
  })

  it('prints a symbolic area as written (exact values are build step 3)', () => {
    const result = rendered(`${SQUARE_AND_CIRCLE}\nlabel: area R = 16 - 4π`)
    expect(result.errors).toEqual([])
    expect(texts(result.svg).map((t) => t.text)).toContain('16 - 4π')
  })

  // KNOWN GAP (handoff item 17): symbolic values are printed as written and
  // never checked, engine-wide — a wrong one passes. Flip this to a refusal
  // at build step 3 (exact values).
  it('KNOWN GAP (handoff item 17): a wrong symbolic area is printed as written and not checked', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nlabel: area R = 16 - 3π`)).toEqual([])
  })

  it('accepts any stated area under @scale: false, the rounded one included', () => {
    expect(errorsOf(`@scale: false\n${SQUARE_AND_CIRCLE}\nlabel: area R = 3.434`)).toEqual([])
    expect(errorsOf(`@scale: false\n${SQUARE_AND_CIRCLE}\nlabel: area R = 4`)).toEqual([])
  })

  it('refuses an unknown region, pointing at name: on a fill', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nlabel: area Q`)).toEqual([
      'Unknown region "Q" — name a shaded region with "name:" on its "fill:" line first (e.g. "fill: square ABCD minus circle O name: Q")',
    ])
  })

  it('says a named fill was refused, rather than calling its name unknown (fix round 1, M3)', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nfill: square ABCD minus square ABCD name: Q\nlabel: area Q`)).toEqual([
      'square ABCD minus square ABCD leaves nothing to shade',
      '"Q" was named, but its fill was refused: square ABCD minus square ABCD leaves nothing to shade',
    ])
    // Hidden, the fill reports nothing itself; the area still says why.
    expect(errorsOf(`@hide: Q\n${SQUARE_AND_CIRCLE}\nfill: square ABCD minus square ABCD name: Q\ngiven: area Q`)).toEqual([
      '"Q" was named, but its fill was refused: square ABCD minus square ABCD leaves nothing to shade',
    ])
  })

  it('refuses a name carried by more than one fill as ambiguous, naming the fills (fix round 1, M4)', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nfill: triangle ABD name: Q\nfill: triangle BCD name: Q\nlabel: area Q`)).toEqual([
      '"Q" names 2 fills ("fill: triangle ABD", "fill: triangle BCD"), so which region it means is ambiguous — give the one to measure a name of its own',
    ])
  })

  it('says relations between areas are not stated yet (fix round 1, M6)', () => {
    expect(() => parseStatement('given: area R < area S')).toThrow(
      'Relations between areas are not stated yet — give each area its own line ("given: area R", "given: area S")'
    )
    expect(() => parseStatement('given: area R congruent area S')).toThrow(/Relations between areas are not stated yet/)
    // Fix round 2 — an area stated equal to another area is a relation too,
    // not a symbol to print.
    expect(() => parseStatement('given: area R = area S')).toThrow(
      'Relations between areas are not stated yet — give each area its own line ("given: area R", "given: area S")'
    )
    expect(() => parseStatement('label: area R = area S')).toThrow(/Relations between areas are not stated yet/)
    expect(() => parseStatement('find: area R = area S')).toThrow('("find: area R", "find: area S")')
  })

  it('measures a region whose fill is hidden', () => {
    const svg = rendered(`@hide: R\n${SQUARE_AND_CIRCLE}\ngiven: area R`).svg
    expect(layer(svg, 'regions')).toBe('')
    expect(texts(svg).map((t) => t.text)).toContain('3.434')
  })
})

describe('given: area', () => {
  it('prints the lens of two unit circles in the table', () => {
    const result = rendered(`@mode: figure
K = (0, 0)
L = (1, 0)
O = circle K, 1
P = circle L, 1
given: area circle O and circle P`)
    expect(result.errors).toEqual([])
    const row = texts(result.svg).map((t) => t.text)
    expect(row).toContain('area circle O and circle P')
    expect(row).toContain('1.228')
  })
})

describe('F6 — where an area label hangs', () => {
  it('an annulus: in the ring, at (0, −2.25), not in the hole', () => {
    const svg = rendered(`@mode: figure
M = (0, 0)
O = circle M, 3
P = circle M, 2
fill: circle O minus circle P name: R
label: area R
(0, -2.25)`).svg
    const label = texts(svg).find((t) => t.text === '15.708') // 5π
    expect(label).toBeDefined()
    expect(centredOn(label!, dot(svg))).toBe(true)
  })

  it('a square minus its inscribed circle: in the lower-left corner, at (−1.661, −1.5)', () => {
    const svg = rendered(`${SQUARE_AND_CIRCLE}
label: area R
(-(2 + sqrt(1.75))/2, -1.5)`).svg
    const label = texts(svg).find((t) => t.text === '3.434')
    expect(label).toBeDefined()
    expect(centredOn(label!, dot(svg))).toBe(true)
  })
})
