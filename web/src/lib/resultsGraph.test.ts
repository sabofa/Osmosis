import { describe, it, expect } from 'vitest'
import { daysAgo, historySpec } from './resultsGraph'

const now = new Date(Date.UTC(2026, 8, 21, 12, 0, 0))

describe('historySpec', () => {
  it('measures fractional days back from now', () => {
    expect(daysAgo('2026-09-21 12:00:00', now)).toBe(0)
    expect(daysAgo('2026-09-21 00:00:00', now)).toBe(0.5)
    expect(daysAgo('2026-09-14 12:00:00', now)).toBe(7)
  })

  it('draws one point per attempt, so several attempts in a day make a line', () => {
    const spec = historySpec(
      [
        { at: '2026-09-21 09:00:00', mean_score: 0.25, responses: 4 },
        { at: '2026-09-21 12:00:00', mean_score: 1, responses: 4 },
        { at: '2026-09-18 12:00:00', mean_score: 0.5, responses: 1 },
      ],
      { now }
    )
    const lines = spec.split('\n')
    expect(lines[0]).toBe('@bounds: -7,1,-0.05,1.05')
    expect(lines).toContain('(-3,0.5) -- (-0.125,0.25)')
    expect(lines).toContain('(-0.125,0.25) -- (0,1)')
    expect(lines).toContain('(0,1)')
  })

  it('widens the window to the oldest point and coarsens the grid', () => {
    const spec = historySpec([{ at: '2026-06-01 12:00:00', mean_score: 0.25, responses: 1 }], { now, days: 180 })
    expect(spec).toContain('@bounds: -114,1,-0.05,1.05')
    expect(spec).toContain('@xstep: 14')
  })

  it('drops points outside the window and draws nothing with none', () => {
    const spec = historySpec([{ at: '2025-01-01 00:00:00', mean_score: 1, responses: 1 }], { now, days: 30 })
    expect(spec).toBe('@bounds: -30,1,-0.05,1.05\n@xstep: 7\n@ystep: 0.25\n@hover: points')
  })
})
