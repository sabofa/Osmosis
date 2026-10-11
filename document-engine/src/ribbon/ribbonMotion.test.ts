import { describe, it, expect } from 'vitest'
import { inkGeometry, inkTransform, popoverOriginX, presenceInit, presenceReduce, parseTimeList, exitDurationMs } from './ribbonMotion'

describe('indicator geometry', () => {
  it('follows the target box and rounds to hundredths', () => {
    expect(inkGeometry({ offsetLeft: 58.004, offsetWidth: 61.333333 })).toEqual({ x: 58, w: 61.33 })
  })
  it('never goes negative in width', () => {
    expect(inkGeometry({ offsetLeft: 4, offsetWidth: -3 }).w).toBe(0)
  })
  it('is a translate then a stretch of a 1px bar', () => {
    expect(inkTransform({ x: 10, w: 40 })).toBe('translateX(10px) scaleX(40)')
  })
})

describe('popover origin', () => {
  it('grows from the middle of the trigger', () => {
    expect(popoverOriginX(100, 28, 90, 200)).toBe(24)
  })
  it('is clamped to the popover box', () => {
    expect(popoverOriginX(10, 28, 90, 200)).toBe(0)
    expect(popoverOriginX(600, 28, 90, 200)).toBe(200)
  })
})

describe('presence state machine', () => {
  it('open mounts, close keeps it mounted, done unmounts', () => {
    let s = presenceInit(false)
    expect(s.mounted).toBe(false)
    s = presenceReduce(s, 'open')
    expect(s).toMatchObject({ open: true, mounted: true, gen: 1 })
    s = presenceReduce(s, 'close')
    expect(s).toMatchObject({ open: false, mounted: true })
    s = presenceReduce(s, 'done')
    expect(s).toMatchObject({ open: false, mounted: false })
  })
  it('a late done after a reopen does not unmount the new popover', () => {
    let s = presenceInit(true)
    s = presenceReduce(s, 'close')
    s = presenceReduce(s, 'open')
    expect(s.gen).toBe(1)
    expect(presenceReduce(s, 'done').mounted).toBe(true)
  })
  it('repeated events are idempotent', () => {
    const open = presenceInit(true)
    expect(presenceReduce(open, 'open')).toBe(open)
    const closed = presenceInit(false)
    expect(presenceReduce(closed, 'close')).toBe(closed)
    expect(presenceReduce(closed, 'done')).toBe(closed)
  })
})

describe('exit duration', () => {
  it('parses s and ms lists', () => {
    expect(parseTimeList('0.12s, 80ms')).toEqual([120, 80])
    expect(parseTimeList('0s')).toEqual([0])
    expect(parseTimeList('')).toEqual([0])
  })
  it('is the longest duration plus its delay', () => {
    expect(exitDurationMs('0.08s', '0s', '0s', '0s')).toBe(80)
    expect(exitDurationMs('0s', '0s', '0.12s, 0.2s', '0s, 0.05s')).toBe(250)
  })
  it('is 0 when nothing animates (reduced motion / scale 0): unmount at once, never hang', () => {
    expect(exitDurationMs('0s', '0s', '0s', '0s')).toBe(0)
    expect(exitDurationMs('', '', '', '')).toBe(0)
  })
})
