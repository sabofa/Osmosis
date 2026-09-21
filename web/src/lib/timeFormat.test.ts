import { describe, it, expect } from 'vitest'
import { formatClock, timerClass, nextTimeUpPhase, FINAL_STRETCH_SEC } from './timeFormat'

describe('formatClock', () => {
  it('formats m:ss with a two-digit seconds field', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7_000)).toBe('0:07')
    expect(formatClock(67_000)).toBe('1:07')
    expect(formatClock(600_000)).toBe('10:00')
  })

  it('does not pad the minutes field', () => {
    expect(formatClock(65_000)).toBe('1:05')
  })

  it('keeps counting in minutes past an hour', () => {
    expect(formatClock(3_600_000)).toBe('60:00')
    expect(formatClock(3_725_000)).toBe('62:05')
  })

  it('floors partial seconds rather than rounding a 0:00 up to 0:01', () => {
    expect(formatClock(999)).toBe('0:00')
    expect(formatClock(1_999)).toBe('0:01')
  })

  it('never shows negative time', () => {
    expect(formatClock(-5_000)).toBe('0:00')
  })
})

describe('timerClass', () => {
  it('marks the final stretch only under a minute', () => {
    expect(timerClass(120)).toBe('')
    expect(timerClass(FINAL_STRETCH_SEC)).toBe('')
    expect(timerClass(59)).toBe('timer-final')
    expect(timerClass(0)).toBe('timer-final')
  })

  it('is quiet when there is no countdown at all', () => {
    expect(timerClass(null)).toBe('')
  })
})

describe('nextTimeUpPhase', () => {
  it('stays put while there is time left, or no countdown at all', () => {
    expect(nextTimeUpPhase('none', 30)).toBe('none')
    expect(nextTimeUpPhase('none', null)).toBe('none')
  })

  it('opens with the message when the clock reaches zero', () => {
    expect(nextTimeUpPhase('none', 0)).toBe('message')
  })

  it('never walks a phase backwards — the message shows once and stays shown', () => {
    // The countdown sits at 0 for every tick after it runs out, so this is
    // called repeatedly with the same input; re-opening the message would
    // reset the two seconds each time and the Finish button would never land.
    expect(nextTimeUpPhase('message', 0)).toBe('message')
    expect(nextTimeUpPhase('finish', 0)).toBe('finish')
  })

  it('does not undo time-up if the countdown somehow reports time again', () => {
    expect(nextTimeUpPhase('finish', 30)).toBe('finish')
    expect(nextTimeUpPhase('message', null)).toBe('message')
  })
})
