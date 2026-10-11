import { describe, expect, it } from 'vitest'
import { chainPoints } from '../../scene/chains'
import { ChainSink } from './sink'

const clip = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }

describe('ChainSink', () => {
  it('clips a segment that crosses the box, with an interpolated parameter at each cut', () => {
    const s = new ChainSink(clip)
    s.segment(-2, 0, 10, 2, 0, 14)
    const [c] = s.chains()
    expect(chainPoints(c)).toEqual([{ x: -1, y: 0 }, { x: 1, y: 0 }])
    expect(Array.from(c.param)).toEqual([11, 13])
    expect(c.closed).toBe(false)
  })

  it('adds nothing for a segment wholly outside', () => {
    const s = new ChainSink(clip)
    s.segment(-3, -3, 0, -2, 5, 1)
    s.segment(2, -4, 1, 5, 4, 2)
    expect(s.chains()).toHaveLength(0)
  })

  it('lift() ends the chain: the next segment starts another', () => {
    const s = new ChainSink(clip)
    s.segment(-0.5, 0, 0, 0, 0, 1)
    s.lift()
    s.segment(0, 0, 1, 0.5, 0, 2)
    const cs = s.chains()
    expect(cs).toHaveLength(2)
    expect(chainPoints(cs[0])).toEqual([{ x: -0.5, y: 0 }, { x: 0, y: 0 }])
    expect(chainPoints(cs[1])).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0 }])
  })

  it('a segment that starts at the pen extends the chain', () => {
    const s = new ChainSink(clip)
    s.segment(-0.5, -0.5, 0, 0, 0, 1)
    s.segment(0, 0, 1, 0.5, 0.25, 2)
    s.segment(0.5, 0.25, 2, 0.75, 0.5, 3)
    const cs = s.chains()
    expect(cs).toHaveLength(1)
    expect(Array.from(cs[0].param)).toEqual([0, 1, 2, 3])
    expect(cs[0].xy.length).toBe(8)
  })

  it('a segment that does not start at the pen starts a new chain, by position and by parameter', () => {
    const moved = new ChainSink(clip)
    moved.segment(0, 0, 0, 0.5, 0, 1)
    moved.segment(0.6, 0, 1, 0.9, 0, 2)
    expect(moved.chains()).toHaveLength(2)

    const reparam = new ChainSink(clip)
    reparam.segment(0, 0, 0, 0.5, 0, 1)
    // the same position, but not the same parameter: not the same vertex
    reparam.segment(0.5, 0, 1.5, 0.9, 0, 2)
    expect(reparam.chains()).toHaveLength(2)
  })

  it('ends the chain at the boundary where a segment leaves, and starts one where it enters', () => {
    const s = new ChainSink(clip)
    s.segment(-0.5, 0, 0, 0.5, 0, 1)
    s.segment(0.5, 0, 1, 1.5, 0, 2) // leaves through x = 1 at t = 1.5
    s.segment(1.5, 0, 2, 1.5, 0.5, 3) // wholly outside
    s.segment(1.5, 0.5, 3, 0.5, 0.5, 4) // comes back in through x = 1 at t = 3.5
    const cs = s.chains()
    expect(cs).toHaveLength(2)
    expect(chainPoints(cs[0])).toEqual([{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }])
    expect(Array.from(cs[0].param)).toEqual([0, 1, 1.5])
    expect(chainPoints(cs[1])).toEqual([{ x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }])
    expect(Array.from(cs[1].param)).toEqual([3.5, 4])
    // leaving the overscan box is not mathematics: no break
    expect(s.breaks()).toEqual([])
  })

  it('drops chains of fewer than 2 vertices', () => {
    const s = new ChainSink(clip)
    s.segment(-2, 0, 0, 0, -2, 1) // touches the corner (-1, -1) and nothing else
    s.lift()
    s.segment(0.5, 0.5, 2, 0.5, 0.5, 2) // no extent: the same vertex twice is one vertex
    expect(s.chains()).toHaveLength(0)
  })

  it('keeps every vertex finite and inside the box, whatever it is given', () => {
    // a deterministic scatter (a small LCG: no Math.random in plot/)
    let seed = 12345
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const s = new ChainSink(clip)
    let prev: [number, number, number] | null = null
    for (let i = 0; i < 2000; i++) {
      const scale = i % 7 === 0 ? 1e6 : 3
      const p: [number, number, number] = [(next() - 0.5) * scale, (next() - 0.5) * scale, i]
      if (prev) s.segment(prev[0], prev[1], prev[2], p[0], p[1], p[2])
      if (i % 11 === 0) s.lift()
      prev = p
    }
    expect(s.chains().length).toBeGreaterThan(10)
    for (const c of s.chains()) {
      expect(c.param.length).toBeGreaterThanOrEqual(2)
      for (const p of chainPoints(c)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        expect(p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1).toBe(true)
      }
      for (const t of c.param) expect(Number.isFinite(t)).toBe(true)
    }
  })

  it('does not connect across a non-finite end: it lifts', () => {
    const s = new ChainSink(clip)
    s.segment(-0.5, 0, 0, 0, 0, 1)
    s.segment(0, 0, 1, Number.NaN, 0, 2)
    s.segment(0, 0, 1, 0.5, 0, 2) // the pen was lifted: a new chain from the same vertex
    s.segment(0.5, 0, 2, Number.POSITIVE_INFINITY, 0, 3)
    expect(s.chains()).toHaveLength(2)
  })

  it('survives endpoints at the extremes of the doubles, where the difference overflows', () => {
    const s = new ChainSink(clip)
    s.segment(-1.7e308, -1.7e308, 0, 1.7e308, 1.7e308, 4)
    expect(s.chains().length).toBeGreaterThan(0)
    for (const c of s.chains()) {
      for (const p of chainPoints(c)) expect(p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1).toBe(true)
      for (const t of c.param) expect(Number.isFinite(t)).toBe(true)
    }
  })

  it('records breaks in the order given, and chains() can be read mid-way', () => {
    const s = new ChainSink(clip)
    s.segment(-0.5, 0, 0, 0.5, 0, 1)
    s.addBreak(2, 'pole')
    s.addBreak(1, 'edge')
    expect(s.breaks()).toEqual([{ at: 2, kind: 'pole' }, { at: 1, kind: 'edge' }])
    expect(s.chains()).toHaveLength(1)
    // reading did not end the chain
    s.segment(0.5, 0, 1, 0.75, 0, 2)
    expect(s.chains()).toHaveLength(1)
    expect(s.chains()[0].param.length).toBe(3)
  })
})
