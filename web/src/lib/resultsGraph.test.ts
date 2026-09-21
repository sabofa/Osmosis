import { describe, it, expect } from 'vitest'
import { daysAgo, historySpec } from './resultsGraph'

const today = new Date(Date.UTC(2026, 8, 21))

describe('historySpec', () => {
  it('counts days back from today', () => {
    expect(daysAgo('2026-09-21', today)).toBe(0)
    expect(daysAgo('2026-09-14', today)).toBe(7)
  })

  it('plots one point per day, joined in order, inside a fixed frame', () => {
    const spec = historySpec(
      [
        { date: '2026-09-21', mean_score: 1, responses: 2 },
        { date: '2026-09-18', mean_score: 0.5, responses: 1 },
      ],
      { today }
    )
    const lines = spec.split('\n')
    expect(lines[0]).toBe('@bounds: -7,1,-0.05,1.05')
    expect(lines).toContain('(-3,0.5) -- (0,1)')
    expect(lines).toContain('(-3,0.5)')
    expect(lines).toContain('(0,1)')
  })

  it('widens the window to the oldest point and coarsens the grid', () => {
    const spec = historySpec([{ date: '2026-06-01', mean_score: 0.25, responses: 1 }], { today, days: 180 })
    expect(spec).toContain('@bounds: -114,1,-0.05,1.05')
    expect(spec).toContain('@xstep: 14')
  })

  it('drops points outside the window and draws nothing with none', () => {
    const spec = historySpec([{ date: '2025-01-01', mean_score: 1, responses: 1 }], { today, days: 30 })
    expect(spec).toBe('@bounds: -30,1,-0.05,1.05\n@xstep: 7\n@ystep: 0.25\n@hover: points')
  })
})
