import { describe, it, expect } from 'vitest'
import { createItemClock } from './itemClock'

describe('createItemClock', () => {
  it('reads the seed until it is started', () => {
    const clock = createItemClock(4000)
    expect(clock.read(1000)).toBe(4000)
    expect(clock.read(99_000)).toBe(4000)
  })

  it('accumulates while running', () => {
    const clock = createItemClock()
    clock.start(1000)
    expect(clock.read(1000)).toBe(0)
    expect(clock.read(3500)).toBe(2500)
  })

  it('adds to the seed rather than restarting from zero', () => {
    const clock = createItemClock(7000)
    clock.start(1000)
    expect(clock.read(2000)).toBe(8000)
  })

  it('stops while paused and picks up where it left off', () => {
    const clock = createItemClock()
    clock.start(0)
    clock.pause(1000, 'hidden')
    expect(clock.read(9000)).toBe(1000)
    clock.resume(9000, 'hidden')
    expect(clock.read(9500)).toBe(1500)
  })

  it('needs every hold released before it runs again', () => {
    const clock = createItemClock()
    clock.start(0)
    clock.pause(1000, 'hidden')
    clock.pause(1500, 'attempt')
    clock.resume(5000, 'hidden')
    // Still held by the attempt pause — the tab being visible again is not
    // enough while the tutor's pause stands.
    expect(clock.read(6000)).toBe(1000)
    clock.resume(6000, 'attempt')
    expect(clock.read(6500)).toBe(1500)
  })

  it('treats a repeated pause or resume for the same reason as a no-op', () => {
    const clock = createItemClock()
    clock.start(0)
    clock.pause(1000, 'hidden')
    clock.pause(4000, 'hidden')
    expect(clock.read(4000)).toBe(1000)
    clock.resume(4000, 'hidden')
    clock.resume(6000, 'hidden')
    expect(clock.read(5000)).toBe(2000)
  })

  it('does not start running when a resume arrives before the first start', () => {
    const clock = createItemClock()
    clock.pause(0, 'hidden')
    clock.resume(1000, 'hidden')
    expect(clock.read(5000)).toBe(0)
    clock.start(5000)
    expect(clock.read(6000)).toBe(1000)
  })

  it('starts held when a hold is already standing, then runs on release', () => {
    const clock = createItemClock()
    clock.pause(0, 'hidden')
    clock.start(1000)
    expect(clock.read(3000)).toBe(0)
    clock.resume(3000, 'hidden')
    expect(clock.read(4000)).toBe(1000)
  })

  it('reports whether it is running', () => {
    const clock = createItemClock()
    expect(clock.isRunning()).toBe(false)
    clock.start(0)
    expect(clock.isRunning()).toBe(true)
    clock.pause(10, 'hidden')
    expect(clock.isRunning()).toBe(false)
  })

  it('never goes backwards when the wall clock does', () => {
    const clock = createItemClock()
    clock.start(5000)
    expect(clock.read(4000)).toBe(0)
    clock.pause(4000, 'hidden')
    expect(clock.read(4000)).toBe(0)
  })
})
