import { describe, expect, it } from 'vitest'
import { worldMap } from '../camera/world'
import type { SpaceView } from '../config'
import type { Box3 } from '../scene/types'
import { InputMachine, type InputContext } from './input'

const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const AUTHORED: SpaceView = { azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] }

function context(view: SpaceView = AUTHORED): InputContext {
  return { view, authored: AUTHORED, viewport: { width: 800, height: 600 }, world: worldMap(CUBE, [1, 1, 1]), projection: 'orthographic' }
}

const pointer = (x: number, y: number, time: number, extra: Partial<{ id: number; button: number; buttons: number; shift: boolean }> = {}) => ({
  id: 1,
  button: 0,
  buttons: 1,
  shift: false,
  ...extra,
  x,
  y,
  time,
})

describe('InputMachine', () => {
  it('a pointer down / move / up of (10, 0) orbits azimuth 40 -> 36', () => {
    const input = new InputMachine()
    input.down(pointer(100, 100, 0))
    const moved = input.move(pointer(110, 100, 16), context())
    expect(moved?.azimuth).toBeCloseTo(36, 12)
    expect(moved?.elevation).toBeCloseTo(25, 12)
    input.up(pointer(110, 100, 16), false)
    // Released: further moves do nothing.
    expect(input.move(pointer(150, 100, 40), context(moved!))).toBeNull()
  })

  it('a drag whose buttons read 0 was released unseen: it ends, and later moves do nothing', () => {
    const input = new InputMachine()
    input.down(pointer(100, 100, 0))
    expect(input.move(pointer(110, 100, 16), context())).not.toBeNull()
    expect(input.move(pointer(120, 100, 32, { buttons: 0 }), context())).toBeNull()
    expect(input.active).toBe(false)
    expect(input.move(pointer(130, 100, 48), context())).toBeNull()
  })

  it('losing pointer capture cancels the drag, with no inertia after', () => {
    const input = new InputMachine()
    input.down(pointer(100, 100, 0))
    input.move(pointer(120, 100, 16), context())
    input.move(pointer(140, 100, 32), context())
    input.lose(1)
    expect(input.active).toBe(false)
    expect(input.move(pointer(160, 100, 40), context())).toBeNull()
    expect(input.up(pointer(160, 100, 40), false)).toBeNull()
  })

  it('a move with no button down does nothing', () => {
    expect(new InputMachine().move(pointer(10, 10, 0), context())).toBeNull()
  })

  it('right-drag and shift-drag pan instead of orbiting', () => {
    for (const extra of [{ button: 2 }, { shift: true }]) {
      const input = new InputMachine()
      input.down(pointer(100, 100, 0, extra))
      const moved = input.move(pointer(150, 100, 16, extra), context())!
      expect(moved.azimuth).toBe(40)
      expect(moved.target[0] !== 0 || moved.target[1] !== 0).toBe(true)
    }
  })

  it('the wheel with deltaY < 0 zooms in, one notch = x1.1', () => {
    const input = new InputMachine()
    expect(input.wheel({ deltaY: -100, deltaMode: 0, x: 400, y: 300 }, context()).zoom).toBeCloseTo(1.1, 12)
    expect(input.wheel({ deltaY: 100, deltaMode: 0, x: 400, y: 300 }, context()).zoom).toBeCloseTo(1 / 1.1, 12)
    expect(input.wheel({ deltaY: -3, deltaMode: 1, x: 400, y: 300 }, context()).zoom).toBeCloseTo(1.1, 12)
  })

  it('keys: arrows orbit 5 degrees, + and - zoom, 0 resets', () => {
    const input = new InputMachine()
    expect(input.key('ArrowRight', context())?.azimuth).toBeCloseTo(35, 12)
    expect(input.key('ArrowLeft', context())?.azimuth).toBeCloseTo(45, 12)
    expect(input.key('ArrowDown', context())?.elevation).toBeCloseTo(30, 12)
    expect(input.key('ArrowUp', context())?.elevation).toBeCloseTo(20, 12)
    expect(input.key('+', context())?.zoom).toBeCloseTo(1.1, 12)
    expect(input.key('-', context())?.zoom).toBeCloseTo(1 / 1.1, 12)
    const moved: SpaceView = { azimuth: 100, elevation: -10, zoom: 3, target: [0.5, 0, 0] }
    expect(input.key('0', context(moved))).toEqual(AUTHORED)
    expect(input.key('q', context())).toBeNull()
  })

  it('releases a fast orbit drag into inertia, unless motion is reduced or the drag had stopped', () => {
    const drag = (reduced: boolean, releaseAt: number) => {
      const input = new InputMachine()
      input.down(pointer(100, 100, 0))
      input.move(pointer(120, 100, 16), context())
      input.move(pointer(140, 100, 32), context())
      return input.up(pointer(140, 100, releaseAt), reduced)
    }
    const v = drag(false, 40)
    expect(v).not.toBeNull()
    // 20 px per 16 ms to the right is -0.5 degrees per ms of azimuth.
    expect(v!.azimuth).toBeCloseTo(-0.5, 6)
    expect(drag(true, 40)).toBeNull()
    expect(drag(false, 400)).toBeNull()
  })

  it('gives no inertia to movement packed into less than two frames, and caps a flick at 0.6 degrees per ms', () => {
    // One move 1 ms after the press: 30 px would read as 12 degrees per ms.
    const jump = new InputMachine()
    jump.down(pointer(100, 100, 0))
    jump.move(pointer(130, 100, 1), context())
    expect(jump.up(pointer(130, 100, 1), false)).toBeNull()
    // Several moves within 3 ms (a coalesced or synthetic drag): no inertia either.
    const burst = new InputMachine()
    burst.down(pointer(100, 100, 0))
    for (let i = 1; i <= 3; i++) burst.move(pointer(100 + i * 10, 100, i), context())
    expect(burst.up(pointer(130, 100, 3), false)).toBeNull()
    // Three 100 px moves 16 ms apart: 2.5 degrees per ms, capped.
    const flick = new InputMachine()
    flick.down(pointer(0, 100, 0))
    for (let i = 1; i <= 3; i++) flick.move(pointer(i * 100, 100, i * 16), context())
    const v = flick.up(pointer(300, 100, 48), false)!
    expect(Math.hypot(v.azimuth, v.elevation)).toBeCloseTo(0.6, 9)
    expect(v.azimuth).toBeLessThan(0)
  })

  it('pinches: two pointers moving apart zoom in about their midpoint', () => {
    const input = new InputMachine()
    input.down(pointer(300, 300, 0, { id: 1 }))
    input.down(pointer(500, 300, 0, { id: 2 }))
    const zoomed = input.move(pointer(550, 300, 16, { id: 2 }), context())!
    expect(zoomed.zoom).toBeCloseTo(250 / 200, 9)
    expect(zoomed.azimuth).toBe(40)
  })
})
