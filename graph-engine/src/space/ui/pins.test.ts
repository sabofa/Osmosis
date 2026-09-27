import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { createSpaceKernel } from '../kernel/index'
import type { Hit } from '../pick/types'
import type { MeshMark, Vec3 } from '../scene/types'
import { dropFeet, interactionMarks, wallKey } from './interactionLayer'
import { isClick, NO_PINS, reducePins } from './pins'

function hitAt(position: Vec3, object = 's1'): Hit {
  return { source: { line: 1, statement: null, object }, kind: 'point', position, values: [], at: { kind: 'point', index: 0 } }
}

describe('isClick', () => {
  it('is a press released within 4 px and 400 ms; a 5 px move is a drag', () => {
    expect(isClick({ x: 10, y: 10, time: 0 }, { x: 13, y: 10, time: 100 })).toBe(true)
    expect(isClick({ x: 10, y: 10, time: 0 }, { x: 13, y: 14, time: 100 })).toBe(false)
    expect(isClick({ x: 10, y: 10, time: 0 }, { x: 15, y: 10, time: 100 })).toBe(false)
    expect(isClick({ x: 10, y: 10, time: 0 }, { x: 10, y: 10, time: 400 })).toBe(false)
  })
})

describe('the pins reducer', () => {
  it('pins a clicked hit, and reports it', () => {
    const hit = hitAt([1, 2, 3])
    const { state, events } = reducePins(NO_PINS, { type: 'click', x: 100, y: 100, hit, markers: [] })
    expect(state.pins).toEqual([{ id: 1, hit }])
    expect(events).toEqual([{ type: 'pin', action: 'add', hit }])
    // A click on nothing adds nothing.
    expect(reducePins(state, { type: 'click', x: 300, y: 300, hit: null, markers: [{ id: 1, x: 100, y: 100 }] }).state).toBe(state)
  })

  it('removes the pin whose marker is within 8 px of the click, instead of adding one', () => {
    const a = hitAt([1, 2, 3])
    const b = hitAt([0, 0, 0], 's2')
    let s = reducePins(NO_PINS, { type: 'click', x: 100, y: 100, hit: a, markers: [] }).state
    s = reducePins(s, { type: 'click', x: 200, y: 100, hit: b, markers: [{ id: 1, x: 100, y: 100 }] }).state
    const markers = [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 200, y: 100 },
    ]
    const near = reducePins(s, { type: 'click', x: 206, y: 105, hit: hitAt([9, 9, 9]), markers })
    expect(near.state.pins.map((p) => p.id)).toEqual([1])
    expect(near.events).toEqual([{ type: 'pin', action: 'remove', hit: b }])
    // 9 px away is not near: that click pins.
    const far = reducePins(s, { type: 'click', x: 209, y: 100, hit: hitAt([9, 9, 9]), markers })
    expect(far.state.pins.map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('clears every pin on Esc, reporting one clear', () => {
    let s = reducePins(NO_PINS, { type: 'click', x: 0, y: 0, hit: hitAt([1, 1, 1]), markers: [] }).state
    s = reducePins(s, { type: 'click', x: 50, y: 0, hit: hitAt([2, 2, 2]), markers: [] }).state
    const cleared = reducePins(s, { type: 'clear' })
    expect(cleared.state.pins).toEqual([])
    expect(cleared.events).toEqual([{ type: 'pin', action: 'clear', hit: null }])
    expect(reducePins(cleared.state, { type: 'clear' }).events).toEqual([])
  })
})

describe('pins re-evaluated through the new scene', () => {
  const spec = '@param a = 1 range [0, 5]\nz = a*x^2 for x in [-2, 2], y in [-2, 2]\nP = (1, 1, 1)'

  function kernel() {
    const parsed = parseSpec(spec)
    return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
  }

  it('follows a: a pin on z = a x^2 at x = 1 reads z = 2 after a goes 1 -> 2', () => {
    const k = kernel()
    const mesh = k.scene().marks.find((m) => m.kind === 'mesh') as MeshMark
    const pick = mesh.pick!
    if (pick.kind !== 'graph') throw new Error('expected a graph')
    const hit: Hit = { source: mesh.source, kind: 'graph', position: [1, 0.5, pick.f(1, 0.5)], values: [], at: { kind: 'graph', x: 1, y: 0.5 } }
    expect(hit.position[2]).toBe(1)
    const pinned = reducePins(NO_PINS, { type: 'click', x: 0, y: 0, hit, markers: [] }).state
    const after = reducePins(pinned, { type: 'reevaluate', scene: k.setValue('a', 2) }).state
    expect(after.pins).toHaveLength(1)
    expect(after.pins[0].hit.position).toEqual([1, 0.5, 2])
    expect(after.pins[0].hit.values.find((r) => r.label === 'z')?.value).toBe('2')
    expect(after.pins[0].hit.values.find((r) => r.label === '∂f/∂x')?.value).toBe('4')
  })

  it('drops a pin whose mark no longer exists', () => {
    const k = kernel()
    const point = k.scene().marks.find((m) => m.kind === 'points')!
    const pinned = reducePins(NO_PINS, { type: 'click', x: 0, y: 0, hit: { ...hitAt([1, 1, 1]), source: point.source }, markers: [] }).state
    const without = { ...k.scene(), marks: k.scene().marks.filter((m) => m !== point) }
    expect(reducePins(pinned, { type: 'reevaluate', scene: without }).state.pins).toEqual([])
    // With the mark still there it stays.
    expect(reducePins(pinned, { type: 'reevaluate', scene: k.scene() }).state.pins).toHaveLength(1)
  })
})

describe('drop lines', () => {
  const box = { x: { min: 0, max: 4 }, y: { min: 0, max: 4 }, z: { min: 0, max: 4 } }

  it('from (1, 2, 3) in [0, 4]^3, seen from the (+, +, +) side, fall to (1, 2, 0), (0, 2, 3) and (1, 0, 3)', () => {
    expect(dropFeet([1, 2, 3], box, [1, 1, 1])).toEqual([
      [1, 2, 0],
      [0, 2, 3],
      [1, 0, 3],
    ])
  })

  it('follow the walls round: seen from (-, -, -), the back walls are x = 4, y = 4 and the floor z = 4', () => {
    expect(dropFeet([1, 2, 3], box, [-1, -1, -1])).toEqual([
      [1, 2, 4],
      [4, 2, 3],
      [1, 4, 3],
    ])
    expect(wallKey([1, 1, 1])).not.toBe(wallKey([-1, 1, 1]))
  })

  it('makes a dashed 1 px line per foot, a dot per foot and a ring per point, never hidden-dashed', () => {
    const marks = interactionMarks([[1, 2, 3], [2, 2, 2]], box, [1, 1, 1], { marker: '#c65d22', ink: '#17170f' })
    const [lines, feet, markers] = marks
    if (lines.kind !== 'lines' || feet.kind !== 'points' || markers.kind !== 'points') throw new Error('unexpected marks')
    expect(lines.starts).toHaveLength(6)
    expect(lines.style).toMatchObject({ width: 1, hidden: 'none' })
    expect(lines.style.dash).not.toBeNull()
    expect(feet.positions).toHaveLength(18)
    expect(markers.style).toMatchObject({ shape: 'ring', size: 10, color: { author: '#c65d22', slot: 0 } })
    expect(interactionMarks([], box, [1, 1, 1], { marker: '#000000', ink: '#000000' })).toEqual([])
  })
})
