import { describe, expect, it } from 'vitest'
import { estimateTextSize } from './labels'
import { fmt } from './svg'
import {
  layoutNotation,
  notationElements,
  overmarkGeometry,
  relationSymbol,
  type NotationRun,
} from './notation'

const FONT = 20
const ORIGIN = { x: 100, y: 50 }

function placed(runs: NotationRun[], fontSize = FONT) {
  return layoutNotation(runs, fontSize)
}

describe('layoutNotation', () => {
  it('places runs left to right, each at the running width of the ones before it', () => {
    const layout = placed([
      { text: 'AB', mark: 'segment' },
      { text: ' = 8', mark: 'none' },
    ])
    const first = estimateTextSize('AB', FONT).width
    expect(layout.runs[0].x).toBe(0)
    expect(layout.runs[0].width).toBeCloseTo(first, 12)
    expect(layout.runs[1].x).toBeCloseTo(first, 12)
    expect(layout.width).toBeCloseTo(first + estimateTextSize(' = 8', FONT).width, 12)
  })

  it('reserves room above the glyphs when a run carries a mark, and not otherwise', () => {
    const plain = placed([{ text: 'AB', mark: 'none' }])
    const marked = placed([{ text: 'AB', mark: 'segment' }])
    // Unmarked: the plain text box, centred on the baseline row.
    expect(plain.top).toBeCloseTo(-0.575 * FONT, 12)
    expect(plain.height).toBeCloseTo(1.15 * FONT, 12)
    // Marked: the box grows upward only, so the glyph row stays where it is.
    expect(marked.bottom).toBeCloseTo(plain.bottom, 12)
    expect(marked.top).toBeLessThan(plain.top)
    expect(marked.height).toBeCloseTo(marked.bottom - marked.top, 12)
  })

  it('reserves the same room for every mark, so a mixed row does not wobble', () => {
    const bar = placed([{ text: 'AB', mark: 'segment' }])
    const ray = placed([{ text: 'AB', mark: 'ray' }])
    const arc = placed([{ text: 'PQ', mark: 'arc' }])
    expect(ray.top).toBeCloseTo(bar.top, 12)
    expect(arc.top).toBeCloseTo(bar.top, 12)
  })

  it('scales with the font size', () => {
    const small = placed([{ text: 'AB', mark: 'segment' }], 10)
    const large = placed([{ text: 'AB', mark: 'segment' }], 20)
    expect(large.width).toBeCloseTo(small.width * 2, 12)
    expect(large.top).toBeCloseTo(small.top * 2, 12)
  })
})

describe('overmarkGeometry — the segment overbar', () => {
  it('draws a rule above the glyphs it covers', () => {
    const layout = placed([{ text: 'AB', mark: 'segment' }])
    const mark = overmarkGeometry(layout.runs[0], FONT, ORIGIN)
    if (!mark || !mark.bar) throw new Error('expected a bar')
    // 0.36 em to the cap line plus a 0.10 em gap, above the row centre.
    expect(mark.bar.from.y).toBeCloseTo(ORIGIN.y - 0.46 * FONT, 12)
    expect(mark.bar.to.y).toBeCloseTo(mark.bar.from.y, 12)
    // Bracketing the run: a 0.06 em overhang on each side.
    expect(mark.bar.from.x).toBeCloseTo(ORIGIN.x - 0.06 * FONT, 12)
    expect(mark.bar.to.x).toBeCloseTo(ORIGIN.x + layout.runs[0].width + 0.06 * FONT, 12)
    expect(mark.heads).toHaveLength(0)
    expect(mark.arc).toBeNull()
  })

  it('is longer over a three-letter label than over a two-letter one, by the text difference', () => {
    const two = placed([{ text: 'AB', mark: 'segment' }])
    const three = placed([{ text: 'ABC', mark: 'segment' }])
    const barTwo = overmarkGeometry(two.runs[0], FONT, ORIGIN)?.bar
    const barThree = overmarkGeometry(three.runs[0], FONT, ORIGIN)?.bar
    if (!barTwo || !barThree) throw new Error('expected bars')
    const lengthTwo = barTwo.to.x - barTwo.from.x
    const lengthThree = barThree.to.x - barThree.from.x
    expect(lengthThree).toBeGreaterThan(lengthTwo)
    expect(lengthThree - lengthTwo).toBeCloseTo(
      estimateTextSize('ABC', FONT).width - estimateTextSize('AB', FONT).width,
      12
    )
  })

  it('scales with the font size rather than sitting at a fixed distance', () => {
    const small = placed([{ text: 'AB', mark: 'segment' }], 10)
    const large = placed([{ text: 'AB', mark: 'segment' }], 20)
    const barSmall = overmarkGeometry(small.runs[0], 10, { x: 0, y: 0 })?.bar
    const barLarge = overmarkGeometry(large.runs[0], 20, { x: 0, y: 0 })?.bar
    if (!barSmall || !barLarge) throw new Error('expected bars')
    expect(barLarge.from.y).toBeCloseTo(barSmall.from.y * 2, 12)
    expect(barLarge.to.x - barLarge.from.x).toBeCloseTo((barSmall.to.x - barSmall.from.x) * 2, 12)
  })

  it('starts where its own run starts, not where the notation does', () => {
    const layout = placed([
      { text: ' = 8', mark: 'none' },
      { text: 'AB', mark: 'segment' },
    ])
    const mark = overmarkGeometry(layout.runs[1], FONT, ORIGIN)
    if (!mark || !mark.bar) throw new Error('expected a bar')
    // The expected offset is measured here rather than read back out of the
    // layout: asking the layout where it put the run and then checking the
    // mark against that answer passes whether or not runs advance at all.
    expect(mark.bar.from.x).toBeCloseTo(ORIGIN.x + estimateTextSize(' = 8', FONT).width - 0.06 * FONT, 12)
  })
})

describe('overmarkGeometry — rays and lines', () => {
  it('puts one arrow head at the right end of a ray', () => {
    const layout = placed([{ text: 'AB', mark: 'ray' }])
    const mark = overmarkGeometry(layout.runs[0], FONT, ORIGIN)
    if (!mark || !mark.bar) throw new Error('expected a bar')
    expect(mark.heads).toHaveLength(1)
    const head = mark.heads[0]
    expect(head.tip.x).toBeCloseTo(mark.bar.to.x, 12)
    expect(head.tip.y).toBeCloseTo(mark.bar.to.y, 12)
    // The wings sit behind the tip and straddle the bar symmetrically.
    expect(head.wings[0].x).toBeCloseTo(head.tip.x - 0.24 * FONT, 12)
    expect(head.wings[1].x).toBeCloseTo(head.tip.x - 0.24 * FONT, 12)
    expect(head.wings[0].y - head.tip.y).toBeCloseTo(-(head.wings[1].y - head.tip.y), 12)
    expect(Math.abs(head.wings[0].y - head.tip.y)).toBeCloseTo(0.14 * FONT, 12)
  })

  it('puts a head at both ends of a line, mirrored about the bar centre', () => {
    const layout = placed([{ text: 'AB', mark: 'line' }])
    const mark = overmarkGeometry(layout.runs[0], FONT, ORIGIN)
    if (!mark || !mark.bar) throw new Error('expected a bar')
    expect(mark.heads).toHaveLength(2)
    const [left, right] = mark.heads
    expect(left.tip.x).toBeCloseTo(mark.bar.from.x, 12)
    expect(right.tip.x).toBeCloseTo(mark.bar.to.x, 12)
    // The left head points the other way: its wings are to the right of its tip.
    expect(left.wings[0].x).toBeCloseTo(left.tip.x + 0.24 * FONT, 12)
    expect(right.wings[0].x).toBeCloseTo(right.tip.x - 0.24 * FONT, 12)
    const centre = (mark.bar.from.x + mark.bar.to.x) / 2
    expect(centre - left.tip.x).toBeCloseTo(right.tip.x - centre, 12)
  })
})

describe('overmarkGeometry — the arc overmark', () => {
  it('bows above the glyphs instead of ruling across them', () => {
    const layout = placed([{ text: 'PQ', mark: 'arc' }])
    const mark = overmarkGeometry(layout.runs[0], FONT, ORIGIN)
    if (!mark || !mark.arc) throw new Error('expected an arc')
    expect(mark.bar).toBeNull()
    expect(mark.heads).toHaveLength(0)
    const arc = mark.arc
    const chordY = ORIGIN.y - 0.46 * FONT
    expect(arc.from.y).toBeCloseTo(chordY, 12)
    expect(arc.to.y).toBeCloseTo(chordY, 12)
    // The apex — the top of the circle — stands one sagitta above the chord.
    // This is the assertion that says it is actually an arc: it ties the
    // radius, the chord and the bulge together.
    expect(arc.center.y - arc.radius).toBeCloseTo(chordY - 0.16 * FONT, 10)
    // ...and the endpoints really are on that circle.
    for (const end of [arc.from, arc.to]) {
      expect(Math.hypot(end.x - arc.center.x, end.y - arc.center.y)).toBeCloseTo(arc.radius, 9)
    }
  })

  it('sweeps left to right over the top', () => {
    const layout = placed([{ text: 'PQ', mark: 'arc' }])
    const arc = overmarkGeometry(layout.runs[0], FONT, ORIGIN)?.arc
    if (!arc) throw new Error('expected an arc')
    expect(arc.endAngle).toBeGreaterThan(arc.startAngle)
    expect(arc.endAngle - arc.startAngle).toBeLessThan(Math.PI)
    // Both endpoints are above the centre (y grows downward in view space).
    expect(arc.from.y).toBeLessThan(arc.center.y)
  })
})

describe('overmarkGeometry — no mark', () => {
  it('produces nothing for an unmarked run', () => {
    const layout = placed([{ text: ' = 8', mark: 'none' }])
    expect(overmarkGeometry(layout.runs[0], FONT, ORIGIN)).toBeNull()
  })
})

describe('notationElements', () => {
  const style = { fill: '#111111', fontFamily: 'sans-serif' }

  it('emits one text element per run, each at its own offset', () => {
    const layout = placed([
      { text: 'AB', mark: 'segment' },
      { text: ' = 8', mark: 'none' },
    ])
    const markup = notationElements(layout, ORIGIN, style).join('')
    expect(markup).toContain('>AB<')
    expect(markup).toContain('= 8')
    expect(markup).toContain(`x="${fmt(ORIGIN.x)}"`)
    expect(markup).toContain(`x="${fmt(ORIGIN.x + estimateTextSize('AB', FONT).width)}"`)
  })

  it('marks only the run that asked for one — "AB = 8" bars AB and not "= 8"', () => {
    const composed = placed([
      { text: 'AB', mark: 'segment' },
      { text: ' = 8', mark: 'none' },
    ])
    const barredBoth = placed([
      { text: 'AB', mark: 'segment' },
      { text: ' = 8', mark: 'segment' },
    ])
    const countLines = (m: string[]) => m.join('').split('<line').length - 1
    expect(countLines(notationElements(composed, ORIGIN, style))).toBe(1)
    expect(countLines(notationElements(barredBoth, ORIGIN, style))).toBe(2)
  })

  it('writes the bar at the geometry overmarkGeometry computed', () => {
    const layout = placed([{ text: 'AB', mark: 'segment' }])
    const mark = overmarkGeometry(layout.runs[0], FONT, ORIGIN)
    if (!mark?.bar) throw new Error('expected a bar')
    const markup = notationElements(layout, ORIGIN, style).join('')
    expect(markup).toContain(`y1="${fmt(mark.bar.from.y)}"`)
    expect(markup).toContain(`x2="${fmt(mark.bar.to.x)}"`)
  })

  it('is deterministic — the same notation emits the same bytes', () => {
    const runs: NotationRun[] = [
      { text: 'AB', mark: 'segment' },
      { text: ' ∥ ', mark: 'none' },
      { text: 'CD', mark: 'segment' },
    ]
    const once = notationElements(placed(runs), ORIGIN, style).join('')
    const twice = notationElements(placed(runs), ORIGIN, style).join('')
    expect(once).toBe(twice)
  })

  it('escapes text rather than letting a label write markup', () => {
    const markup = notationElements(placed([{ text: 'A<B', mark: 'none' }]), ORIGIN, style).join('')
    expect(markup).toContain('A&lt;B')
  })
})

describe('relationSymbol', () => {
  // F3 — relations are ordinary characters and need no geometry.
  it('spells the relations an author can type', () => {
    expect(relationSymbol('congruent')).toBe('≅')
    expect(relationSymbol('cong')).toBe('≅')
    expect(relationSymbol('similar')).toBe('~')
    expect(relationSymbol('parallel')).toBe('∥')
    expect(relationSymbol('perpendicular')).toBe('⊥')
    expect(relationSymbol('perp')).toBe('⊥')
    expect(relationSymbol('angle')).toBe('∠')
    expect(relationSymbol('triangle')).toBe('△')
  })

  it('passes a symbol the author already typed straight through', () => {
    expect(relationSymbol('≅')).toBe('≅')
    expect(relationSymbol('∥')).toBe('∥')
  })

  it('is null for a word that names no relation', () => {
    expect(relationSymbol('bisects')).toBeNull()
  })
})
