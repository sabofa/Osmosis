import { describe, expect, it } from 'vitest'
import { FpsMeter } from '../../../../../review/src/paintLabMeter'

// The readout counts frames only while the view is actually being redrawn: an
// idle lab (nothing changing) neither shows a stale rate nor a made-up one.

describe('FpsMeter', () => {
  it('reads the render time of a lone frame, capped at the screen\'s 60', () => {
    expect(new FpsMeter().tick(1000, 40)).toBeCloseTo(25, 9)
    expect(new FpsMeter().tick(1000, 8)).toBe(60)
  })

  it('reads the frame rate of a run of frames: ten frames 20 ms apart are 9 intervals in 180 ms = 50 fps', () => {
    const meter = new FpsMeter()
    let fps = 0
    for (let i = 0; i < 10; i++) fps = meter.tick(1000 + i * 20, 12)
    expect(fps).toBeCloseTo(50, 9)
  })

  it('forgets a run after a pause, so a frame after an idle gap reads its own render time', () => {
    const meter = new FpsMeter()
    for (let i = 0; i < 10; i++) meter.tick(1000 + i * 20, 12)
    expect(meter.tick(4000, 50)).toBeCloseTo(20, 9)
  })

  it('ends a run at a pause well inside the one-second window: 10 frames, then a 420 ms gap, then a 50 ms frame reads 20 fps, not 16.7', () => {
    const meter = new FpsMeter()
    for (let i = 0; i < 10; i++) meter.tick(1000 + i * 20, 12)
    // Without the pause rule the window would still hold the run: 10 intervals in 600 ms = 16.7 fps.
    expect(meter.tick(1600, 50)).toBeCloseTo(20, 9)
  })

  it('only counts the last second of a long run', () => {
    const meter = new FpsMeter()
    let fps = 0
    for (let i = 0; i < 100; i++) fps = meter.tick(i * 50, 5) // 20 fps for 5 s
    expect(fps).toBeCloseTo(20, 9)
    for (let i = 0; i < 100; i++) fps = meter.tick(5000 + i * 25, 5) // then 40 fps
    expect(fps).toBeCloseTo(40, 9)
  })
})
