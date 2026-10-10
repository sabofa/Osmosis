import { describe, it, expect } from 'vitest'
import { toggleHighlightRange, highlightAtOffset, removeHighlightRange } from './highlightOps'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlightPalette'

let n = 0
const makeId = () => `id-${++n}`

const H = (id: string, start: number, end: number, color?: string) =>
  color === undefined ? { id, start, end } : { id, start, end, color }
const nid = expect.any(String)
const spans = (hs: { start: number; end: number; color?: string }[]) =>
  hs.map((h) => [h.start, h.end, h.color] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])

describe('toggleHighlightRange', () => {
  describe('no coverage', () => {
    it('adds one highlight for the whole range', () => {
      expect(toggleHighlightRange([], 5, 10, 'yellow', makeId)).toEqual([{ id: nid, start: 5, end: 10, color: 'yellow' }])
    })
    it('leaves non-overlapping highlights untouched and abutting ones too', () => {
      const a = H('a', 0, 5, 'yellow')
      const b = H('b', 10, 12, 'pink')
      const result = toggleHighlightRange([a, b], 5, 10, 'green', makeId)
      expect(result).toContain(a)
      expect(result).toContain(b)
      expect(result).toContainEqual({ id: nid, start: 5, end: 10, color: 'green' })
      expect(result).toHaveLength(3)
    })
  })

  describe('mixed (rule 1): fill only the gaps', () => {
    it('same colour: keeps the existing highlight, adds both sides', () => {
      const h = H('h1', 5, 10, 'yellow')
      const result = toggleHighlightRange([h], 3, 12, 'yellow', makeId)
      expect(result).toHaveLength(3)
      expect(result[0]).toBe(h)
      expect(spans(result)).toEqual([[3, 5, 'yellow'], [5, 10, 'yellow'], [10, 12, 'yellow']])
    })
    it('different colour: existing untouched, only the uncovered tail is pink', () => {
      const h = H('h1', 5, 10, 'yellow')
      const result = toggleHighlightRange([h], 8, 14, 'pink', makeId)
      expect(result).toHaveLength(2)
      expect(result[0]).toBe(h)
      expect(result[1]).toEqual({ id: nid, start: 10, end: 14, color: 'pink' })
    })
    it('spanning two highlights of different colours with gaps', () => {
      const a = H('a', 2, 6, 'yellow')
      const b = H('b', 10, 14, 'green')
      const result = toggleHighlightRange([a, b], 0, 16, 'pink', makeId)
      expect(result).toContain(a)
      expect(result).toContain(b)
      expect(spans(result)).toEqual([
        [0, 2, 'pink'],
        [2, 6, 'yellow'],
        [6, 10, 'pink'],
        [10, 14, 'green'],
        [14, 16, 'pink'],
      ])
    })
    it('a gap between two adjacent-to-selection highlights is filled', () => {
      const a = H('a', 0, 4, 'yellow')
      const b = H('b', 6, 10, 'yellow')
      const result = toggleHighlightRange([a, b], 2, 8, 'yellow', makeId)
      expect(spans(result)).toEqual([[0, 4, 'yellow'], [4, 6, 'yellow'], [6, 10, 'yellow']])
      expect(result).toContain(a)
      expect(result).toContain(b)
    })
  })

  describe('fully covered, all pieces already the pressed colour (rule 2): remove', () => {
    it('exact match removes it', () => {
      expect(toggleHighlightRange([H('h1', 5, 10, 'yellow')], 5, 10, 'yellow', makeId)).toEqual([])
    })
    it('inside one highlight splits into two remainders', () => {
      const result = toggleHighlightRange([H('h1', 0, 20, 'yellow')], 8, 12, 'yellow', makeId)
      expect(result).toHaveLength(2)
      expect(spans(result)).toEqual([[0, 8, 'yellow'], [12, 20, 'yellow']])
      expect(result.every((h) => h.id !== 'h1')).toBe(true)
    })
    it('spanning two adjacent same-colour highlights removes only the selected part', () => {
      const result = toggleHighlightRange([H('a', 0, 10, 'yellow'), H('b', 10, 20, 'yellow')], 5, 15, 'yellow', makeId)
      expect(spans(result)).toEqual([[0, 5, 'yellow'], [15, 20, 'yellow']])
    })
    it('leaves unrelated highlights as the same objects', () => {
      const other = H('o', 30, 40, 'pink')
      const result = toggleHighlightRange([other, H('h1', 5, 10, 'yellow')], 6, 9, 'yellow', makeId)
      expect(result).toContain(other)
      expect(spans(result)).toEqual([[5, 6, 'yellow'], [9, 10, 'yellow'], [30, 40, 'pink']])
    })
  })

  describe('fully covered, not all the pressed colour (rule 3): recolour', () => {
    it('inside a differently-coloured highlight: split plus one recoloured piece', () => {
      const result = toggleHighlightRange([H('h1', 0, 20, 'yellow')], 8, 12, 'pink', makeId)
      expect(spans(result)).toEqual([[0, 8, 'yellow'], [8, 12, 'pink'], [12, 20, 'yellow']])
    })
    it('exact match of a different colour just changes colour', () => {
      const result = toggleHighlightRange([H('h1', 5, 10, 'yellow')], 5, 10, 'pink', makeId)
      expect(spans(result)).toEqual([[5, 10, 'pink']])
    })
    it('multi-colour coverage where pressed colour matches only one: recolour all as one highlight', () => {
      const result = toggleHighlightRange(
        [H('a', 0, 10, 'yellow'), H('b', 10, 20, 'green'), H('c', 20, 30, 'pink')],
        5, 25, 'green', makeId
      )
      expect(spans(result)).toEqual([[0, 5, 'yellow'], [5, 25, 'green'], [25, 30, 'pink']])
      expect(result.filter((h) => h.color === 'green')).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('undefined stored colour equals the default colour', () => {
      // same -> remove
      expect(toggleHighlightRange([H('h1', 5, 10)], 5, 10, DEFAULT_HIGHLIGHT_COLOR, makeId)).toEqual([])
      // different -> recolour, remainder keeps undefined colour
      const result = toggleHighlightRange([H('h1', 0, 10)], 2, 4, 'pink', makeId)
      expect(spans(result)).toEqual([[0, 2, undefined], [2, 4, 'pink'], [4, 10, undefined]])
      // pressed default over mixed coverage keeps the undefined one as is
      const h = H('h2', 5, 8)
      const mixed = toggleHighlightRange([h], 4, 9, DEFAULT_HIGHLIGHT_COLOR, makeId)
      expect(mixed).toContain(h)
      expect(mixed).toHaveLength(3)
    })
    it('empty or inverted selection returns the input unchanged', () => {
      const input = [H('h1', 5, 10, 'yellow')]
      expect(toggleHighlightRange(input, 7, 7, 'pink', makeId)).toBe(input)
      expect(toggleHighlightRange(input, 9, 3, 'pink', makeId)).toBe(input)
    })
    it('does not depend on input order', () => {
      const result = toggleHighlightRange([H('b', 10, 20, 'yellow'), H('a', 0, 10, 'yellow')], 5, 15, 'yellow', makeId)
      expect(spans(result)).toEqual([[0, 5, 'yellow'], [15, 20, 'yellow']])
      const mixed = toggleHighlightRange([H('b', 10, 12, 'green'), H('a', 2, 4, 'yellow')], 0, 14, 'pink', makeId)
      expect(spans(mixed)).toEqual([[0, 2, 'pink'], [2, 4, 'yellow'], [4, 10, 'pink'], [10, 12, 'green'], [12, 14, 'pink']])
    })
    it('large offsets are plain numbers', () => {
      const result = toggleHighlightRange([H('h1', 1_000_000, 2_000_000, 'yellow')], 1_500_000, 2_500_000, 'yellow', makeId)
      expect(spans(result)).toEqual([[1_000_000, 2_000_000, 'yellow'], [2_000_000, 2_500_000, 'yellow']])
    })
    it('overlapping existing highlights: coverage is the union, no crash', () => {
      const result = toggleHighlightRange([H('a', 0, 8, 'yellow'), H('b', 5, 12, 'yellow')], 2, 10, 'yellow', makeId)
      // fully covered by the union and all yellow -> remove [2,10)
      expect(spans(result)).toEqual([[0, 2, 'yellow'], [10, 12, 'yellow']])
    })
    it('idempotence: pressing the same colour twice on an uncovered range highlights then unhighlights', () => {
      const once = toggleHighlightRange([], 4, 9, 'yellow', makeId)
      expect(spans(once)).toEqual([[4, 9, 'yellow']])
      expect(toggleHighlightRange(once, 4, 9, 'yellow', makeId)).toEqual([])
    })
  })
})

describe('removeHighlightRange', () => {
  it('strips highlight coverage regardless of color, splitting around the overlap', () => {
    const existing = [
      { id: 'h1', start: 0, end: 10, color: 'yellow' },
      { id: 'h2', start: 10, end: 20, color: 'green' },
    ]
    const result = removeHighlightRange(existing, 5, 15, makeId)
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 5, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 15, end: 20, color: 'green' })
    expect(result).toHaveLength(2)
  })

  it('leaves non-overlapping highlights untouched and adds nothing', () => {
    const existing = [{ id: 'h1', start: 0, end: 5, color: 'yellow' }]
    const result = removeHighlightRange(existing, 10, 15, makeId)
    expect(result).toEqual(existing)
  })
})

describe('highlightAtOffset', () => {
  it('finds the highlight containing an offset', () => {
    const existing = [
      { id: 'h1', start: 0, end: 5, color: 'yellow' },
      { id: 'h2', start: 10, end: 15, color: 'green' },
    ]
    expect(highlightAtOffset(existing, 12)?.id).toBe('h2')
    expect(highlightAtOffset(existing, 7)).toBeNull()
  })
})
