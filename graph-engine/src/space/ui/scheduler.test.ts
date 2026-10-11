import { describe, expect, it, vi } from 'vitest'
import { FrameScheduler } from './scheduler'

function frames() {
  const queue: ((t: number) => void)[] = []
  const request = vi.fn((cb: (t: number) => void) => queue.push(cb))
  const cancel = vi.fn()
  return {
    request,
    cancel,
    run(time = 0) {
      const due = queue.splice(0)
      due.forEach((cb) => cb(time))
      return due.length
    },
  }
}

describe('FrameScheduler', () => {
  it('collapses any number of requests before the frame into one', () => {
    const f = frames()
    const render = vi.fn(() => false)
    const s = new FrameScheduler(f.request, f.cancel, render)
    s.request()
    s.request()
    s.request()
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.run()).toBe(1)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('does not loop: after a frame, nothing is requested until the next change', () => {
    const f = frames()
    const s = new FrameScheduler(f.request, f.cancel, () => false)
    s.request()
    f.run()
    expect(s.pending).toBe(false)
    expect(f.run()).toBe(0)
    s.request()
    expect(f.request).toHaveBeenCalledTimes(2)
  })

  it('keeps going while the frame asks to (inertia), then stops', () => {
    const f = frames()
    let left = 3
    const s = new FrameScheduler(f.request, f.cancel, () => --left > 0)
    s.request()
    let ran = 0
    while (f.run() > 0) ran++
    expect(ran).toBe(3)
    expect(s.pending).toBe(false)
  })

  it('cancels a pending frame', () => {
    const f = frames()
    const render = vi.fn(() => false)
    const s = new FrameScheduler(f.request, f.cancel, render)
    s.request()
    s.cancel()
    expect(f.cancel).toHaveBeenCalledTimes(1)
    expect(s.pending).toBe(false)
  })
})
