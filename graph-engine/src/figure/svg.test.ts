import { describe, expect, it } from 'vitest'
import { fmt, svgArc, svgCircle, svgCircularSegment, svgEscape, svgGroup, svgLine, svgPolygon, svgPolyline, svgSector, svgText } from './svg'

describe('fmt — the single number formatter', () => {
  it('holds three decimals and drops trailing zeros', () => {
    expect(fmt(1 / 3)).toBe('0.333')
    expect(fmt(2)).toBe('2')
    expect(fmt(2.5)).toBe('2.5')
    expect(fmt(2.1234567)).toBe('2.123')
    expect(fmt(-2.1234567)).toBe('-2.123')
  })

  it('never emits a negative zero', () => {
    expect(fmt(-0)).toBe('0')
    expect(fmt(-0.0001)).toBe('0')
    expect(fmt(-0.0004)).toBe('0')
  })

  it('pins the precision boundary', () => {
    // 0.0005 is the first value that rounds up to a printable digit; 0.0004
    // is the last that vanishes. Both sides are asserted so a change of
    // precision cannot pass unnoticed.
    expect(fmt(0.0005)).toBe('0.001')
    expect(fmt(0.0004)).toBe('0')
    expect(fmt(0.9999)).toBe('1')
    expect(fmt(0.12345)).toBe('0.123')
  })

  it('formats the same float identically however it was computed', () => {
    expect(fmt(0.1 + 0.2)).toBe(fmt(0.3))
    expect(fmt(Math.sqrt(2) ** 2)).toBe(fmt(2))
  })

  it('refuses a non-finite number rather than emitting "NaN" into markup', () => {
    expect(() => fmt(Number.NaN)).toThrow(/finite/)
    expect(() => fmt(Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })
})

describe('svgEscape', () => {
  it('escapes every character that would break markup', () => {
    expect(svgEscape('a & b')).toBe('a &amp; b')
    expect(svgEscape('<tspan>')).toBe('&lt;tspan&gt;')
    expect(svgEscape('say "hi"')).toBe('say &quot;hi&quot;')
    expect(svgEscape("it's")).toBe('it&apos;s')
  })

  it('escapes the ampersand first, so an escape is not double-escaped', () => {
    expect(svgEscape('&lt;')).toBe('&amp;lt;')
  })
})

describe('primitives', () => {
  it('emits a line', () => {
    expect(svgLine({ x: 0, y: 1 }, { x: 2.5, y: -3 }, { stroke: '#123456', 'stroke-width': 2 })).toBe(
      '<line x1="0" y1="1" x2="2.5" y2="-3" stroke="#123456" stroke-width="2"/>'
    )
  })

  it('emits a polyline and a polygon with shared point formatting', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 1 / 3, y: 4 },
    ]
    expect(svgPolyline(points, { stroke: 'red' })).toBe('<polyline points="0,0 1,2 0.333,4" stroke="red"/>')
    expect(svgPolygon(points, { fill: 'blue' })).toBe('<polygon points="0,0 1,2 0.333,4" fill="blue"/>')
  })

  it('emits a circle', () => {
    expect(svgCircle({ x: 1, y: 2 }, 3, { fill: 'none', stroke: 'k' })).toBe('<circle cx="1" cy="2" r="3" fill="none" stroke="k"/>')
  })

  it('emits an arc as a path, with the large-arc and sweep flags set from the swept angle', () => {
    // A quarter turn: small arc, positive sweep.
    expect(svgArc({ x: 0, y: 0 }, 10, 0, Math.PI / 2, { stroke: 'k' })).toBe('<path d="M 10 0 A 10 10 0 0 1 0 10" stroke="k"/>')
    // Three quarters: large arc, still positive sweep.
    expect(svgArc({ x: 0, y: 0 }, 10, 0, (3 * Math.PI) / 2, { stroke: 'k' })).toBe('<path d="M 10 0 A 10 10 0 1 1 0 -10" stroke="k"/>')
    // Backwards a quarter turn: small arc, negative sweep.
    expect(svgArc({ x: 0, y: 0 }, 10, 0, -Math.PI / 2, { stroke: 'k' })).toBe('<path d="M 10 0 A 10 10 0 0 0 0 -10" stroke="k"/>')
  })

  it('emits text with its content escaped', () => {
    expect(svgText({ x: 1, y: 2 }, 'A & B', { 'font-size': 12 })).toBe('<text x="1" y="2" font-size="12">A &amp; B</text>')
  })

  it('emits a group wrapping its children in order', () => {
    expect(svgGroup([svgLine({ x: 0, y: 0 }, { x: 1, y: 1 }, {}), '<x/>'], { id: 'g' })).toBe(
      '<g id="g"><line x1="0" y1="0" x2="1" y2="1"/><x/></g>'
    )
  })

  it('emits an empty group as a self-closing tag', () => {
    expect(svgGroup([], { id: 'g' })).toBe('<g id="g"/>')
  })

  it('omits null and undefined attributes but keeps an empty string', () => {
    expect(svgCircle({ x: 0, y: 0 }, 1, { stroke: null, fill: undefined, 'data-id': '' })).toBe('<circle cx="0" cy="0" r="1" data-id=""/>')
  })

  it('escapes attribute values', () => {
    expect(svgCircle({ x: 0, y: 0 }, 1, { 'data-id': 'a"b&c' })).toBe('<circle cx="0" cy="0" r="1" data-id="a&quot;b&amp;c"/>')
  })

  it('formats numeric attribute values through fmt', () => {
    expect(svgCircle({ x: 0, y: 0 }, 1, { 'stroke-width': 1 / 3 })).toBe('<circle cx="0" cy="0" r="1" stroke-width="0.333"/>')
  })
})

describe('determinism', () => {
  it('produces byte-identical markup for identical input', () => {
    const build = () =>
      svgGroup(
        [
          svgLine({ x: 1 / 3, y: 2 / 7 }, { x: -1 / 9, y: 5 / 11 }, { stroke: '#abcdef', 'stroke-width': 1 / 3 }),
          svgCircle({ x: Math.PI, y: Math.E }, Math.SQRT2, { fill: 'none' }),
          svgArc({ x: 0, y: 0 }, 1 / 3, 0.1, 2.9, { stroke: 'k' }),
          svgText({ x: 1 / 3, y: 1 / 7 }, 'P & Q', { 'font-size': 11 }),
          svgPolygon(
            [
              { x: 1 / 3, y: 1 / 7 },
              { x: 2 / 3, y: 2 / 7 },
            ],
            { fill: 'x' }
          ),
        ],
        { 'data-layer': 'test' }
      )
    expect(build()).toBe(build())
  })
})

describe('the two circle fills', () => {
  it('closes a sector through the centre', () => {
    expect(svgSector({ x: 0, y: 0 }, 10, 0, Math.PI / 2, { fill: 'k' })).toBe(
      '<path d="M 0 0 L 10 0 A 10 10 0 0 1 0 10 Z" fill="k"/>'
    )
  })

  it('closes a circular segment along its own chord, never through the centre', () => {
    const segment = svgCircularSegment({ x: 0, y: 0 }, 10, 0, Math.PI / 2, { fill: 'k' })
    expect(segment).toBe('<path d="M 10 0 A 10 10 0 0 1 0 10 Z" fill="k"/>')
    expect(segment).not.toContain(' L ')
  })

  it('carries the large-arc flag into both fills, so a major sweep fills the right side', () => {
    expect(svgSector({ x: 0, y: 0 }, 10, 0, (3 * Math.PI) / 2, { fill: 'k' })).toContain('A 10 10 0 1 1 ')
    expect(svgCircularSegment({ x: 0, y: 0 }, 10, 0, -(3 * Math.PI) / 2, { fill: 'k' })).toContain('A 10 10 0 1 0 ')
  })

  it('emits a path arc rather than a sampled polyline, like every other arc here', () => {
    for (const markup of [
      svgSector({ x: 1, y: 2 }, 3, 0.1, 2.9, { fill: 'k' }),
      svgCircularSegment({ x: 1, y: 2 }, 3, 0.1, 2.9, { fill: 'k' }),
    ]) {
      expect(markup.startsWith('<path')).toBe(true)
      expect(markup).not.toContain('polyline')
    }
  })

  it('is byte-stable', () => {
    const build = () => svgSector({ x: 1 / 3, y: 0.1 + 0.2 }, 2 / 3, 0.1, 2.9, { fill: 'k' })
    expect(build()).toBe(build())
  })
})
