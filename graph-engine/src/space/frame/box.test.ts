import { describe, expect, it } from 'vitest'
import { defaultSpaceConfig, type SpaceView } from '../config'
import { cameraMatrices, project, type CameraMatrices } from '../camera/projection'
import { worldMap, type WorldMap } from '../camera/world'
import type { Box3, Vec3 } from '../scene/types'
import { boxFrame } from './box'
import { frameAxes } from './ticks'
import { estimateLabelSize, labelsOverlap, thinLabels } from './labels'
import type { FrameLabel, FrameModel } from './types'

const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const VIEWPORT = { width: 800, height: 600 }

function setup(azimuth: number, elevation: number, ticks: Partial<ReturnType<typeof defaultSpaceConfig>['ticks']> = {}) {
  const world = worldMap(CUBE, [1, 1, 1])
  const view: SpaceView = { azimuth, elevation, zoom: 1, target: [0, 0, 0] }
  const camera = cameraMatrices(view, world, VIEWPORT, 'orthographic')
  const space = defaultSpaceConfig()
  const axes = frameAxes({ ...space, ticks: { ...space.ticks, ...ticks } }, CUBE)
  return { world, camera, frame: boxFrame(world, camera, axes) }
}

const onPlane = (p: Vec3, axis: 0 | 1 | 2, value: number) => Math.abs(p[axis] - value) < 1e-12

// Which of the six faces every line of `role` lies in (both endpoints).
function planesOf(frame: FrameModel, role: 'wall' | 'grid'): Set<string> {
  const planes = new Set<string>()
  for (const line of frame.lines.filter((l) => l.role === role)) {
    const found: string[] = []
    for (const axis of [0, 1, 2] as const) {
      for (const value of [-1, 1]) {
        if (onPlane(line.a, axis, value) && onPlane(line.b, axis, value)) found.push(`${'xyz'[axis]}=${value}`)
      }
    }
    expect(found.length).toBeGreaterThan(0)
    // A gridline lies in exactly one wall; an outline edge may be shared.
    if (role === 'grid') expect(found).toHaveLength(1)
    found.forEach((f) => planes.add(f))
  }
  return planes
}

function tickLabels(frame: FrameModel, axis: 'x' | 'y' | 'z'): FrameLabel[] {
  return frame.labels.filter((l) => l.role === 'tick' && l.key.startsWith(`tick:${axis}:`))
}

function hull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: { x: number; y: number }[] = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function insideConvex(poly: { x: number; y: number }[], q: { x: number; y: number }): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
    if (c === 0) continue
    if (sign === 0) sign = Math.sign(c)
    else if (Math.sign(c) !== sign) return false
  }
  return true
}

function screenOf(world: WorldMap, camera: CameraMatrices, label: FrameLabel) {
  const s = project(camera, world.toWorld(label.position))
  return { x: s.x + label.screenOffset[0], y: s.y + label.screenOffset[1] }
}

describe('boxFrame at azimuth 40, elevation 25 over [-1, 1]^3', () => {
  const { world, camera, frame } = setup(40, 25)

  it('puts the back walls at x = -1, y = -1, z = -1', () => {
    expect(planesOf(frame, 'grid')).toEqual(new Set(['x=-1', 'y=-1', 'z=-1']))
    // Every outline edge belongs to a back wall (it may also border a front face).
    const back = (p: Vec3, q: Vec3) => ([0, 1, 2] as const).some((axis) => onPlane(p, axis, -1) && onPlane(q, axis, -1))
    const walls = frame.lines.filter((l) => l.role === 'wall')
    expect(walls).toHaveLength(9)
    for (const w of walls) expect(back(w.a, w.b)).toBe(true)
  })

  it('draws gridlines at the interior tick values of each wall (step 0.2: 9 per axis per wall)', () => {
    // Two walls carry each axis's gridlines; 9 interior ticks of -1..1 at 0.2.
    expect(frame.lines.filter((l) => l.role === 'grid')).toHaveLength(3 * 2 * 9)
  })

  it('puts x ticks on the edge y = +1, z = -1 and y ticks on the edge x = +1, z = -1', () => {
    const xs = tickLabels(frame, 'x')
    const ys = tickLabels(frame, 'y')
    expect(xs.length).toBeGreaterThan(0)
    expect(ys.length).toBeGreaterThan(0)
    for (const l of xs) expect([l.position[1], l.position[2]]).toEqual([1, -1])
    for (const l of ys) expect([l.position[0], l.position[2]]).toEqual([1, -1])
  })

  it('puts z ticks on the leftmost vertical edge, x = +1, y = -1 (screen x ~ -0.643x + 0.766y)', () => {
    const zs = tickLabels(frame, 'z')
    expect(zs.length).toBeGreaterThan(0)
    for (const l of zs) expect([l.position[0], l.position[1]]).toEqual([1, -1])
  })

  it('pushes every tick label outside the projected box hull', () => {
    const corners: { x: number; y: number }[] = []
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(project(camera, [x, y, z]))
    const h = hull(corners)
    const labels = frame.labels.filter((l) => l.role === 'tick')
    expect(labels.length).toBeGreaterThan(10)
    for (const l of labels) expect(insideConvex(h, screenOf(world, camera, l))).toBe(false)
  })

  it('titles each axis with its @titles text, beyond its tick labels', () => {
    const titles = frame.labels.filter((l) => l.role === 'title')
    expect(titles.map((t) => t.text).sort()).toEqual(['x', 'y', 'z'])
    const zTitle = titles.find((t) => t.key === 'title:z')!
    const zLabels = tickLabels(frame, 'z')
    // The z edge is on the left of the box, so its title sits further left than every z label.
    const titleX = screenOf(world, camera, zTitle).x
    for (const l of zLabels) expect(titleX).toBeLessThan(screenOf(world, camera, l).x)
  })

  it('keys tick labels by axis and multiple, so they are stable as the camera moves', () => {
    const other = setup(-60, 25).frame
    const keys = (f: FrameModel) => new Set(f.labels.filter((l) => l.role === 'tick').map((l) => l.key))
    expect(keys(frame).has('tick:x:5')).toBe(true)
    expect(keys(other).has('tick:x:5')).toBe(true)
  })
})

describe('boxFrame labels never collide', () => {
  // The x and y tick edges meet at the front corner, where both end labels
  // sit; thinning within an edge cannot see the other edge.
  for (const [azimuth, elevation] of [
    [40, 25],
    [-50, 30],
    [130, 20],
    [220, 15],
    [40, -30],
  ]) {
    it(`no two tick labels overlap, across edges too, at azimuth ${azimuth}, elevation ${elevation}`, () => {
      const world = worldMap({ x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -4, max: 4 } }, [1, 1, 0.7])
      const camera = cameraMatrices({ azimuth, elevation, zoom: 1, target: [0, 0, 0] }, world, { width: 700, height: 560 }, 'orthographic')
      const axes = frameAxes(defaultSpaceConfig(), world.box)
      const frame = boxFrame(world, camera, axes)
      const boxes = frame.labels
        .filter((l) => l.role === 'tick')
        .map((l) => ({ ...screenOf(world, camera, l), ...estimateLabelSize(l.text, 12), key: l.key }))
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) expect([boxes[i].key, boxes[j].key, labelsOverlap(boxes[i], boxes[j])]).toEqual([boxes[i].key, boxes[j].key, false])
    })
  }
})

describe('the frame key identifies the line geometry', () => {
  const keyOf = (box: Box3, step: number | null, azimuth = 40) => {
    const world = worldMap(box, [1, 1, 1])
    const camera = cameraMatrices({ azimuth, elevation: 25, zoom: 1, target: world.centre }, world, VIEWPORT, 'orthographic')
    const space = defaultSpaceConfig()
    const ticks = step === null ? space.ticks : { ...space.ticks, x: { value: step, pi: null } }
    return boxFrame(world, camera, frameAxes({ ...space, ticks }, box)).key
  }
  const other: Box3 = { x: { min: -2, max: 2 }, y: { min: -1.5, max: 1.5 }, z: { min: -4, max: 4 } }

  it('differs for a different box, or different ticks, with the same wall choice', () => {
    expect(keyOf(other, null)).not.toBe(keyOf(CUBE, null))
    expect(keyOf(CUBE, 0.25)).not.toBe(keyOf(CUBE, null))
  })

  it('is the same for the same box, ticks and wall choice from a nearby camera', () => {
    expect(keyOf(CUBE, null, 42)).toBe(keyOf(CUBE, null, 40))
  })
})

describe('boxFrame flips its walls', () => {
  it('at azimuth 130 the back walls are x = +1 and y = -1', () => {
    const planes = planesOf(setup(130, 25).frame, 'grid')
    expect(planes).toEqual(new Set(['x=1', 'y=-1', 'z=-1']))
  })

  it('looking from below (elevation -30) the floor is z = +1', () => {
    const planes = planesOf(setup(40, -30).frame, 'grid')
    expect(planes).toEqual(new Set(['x=-1', 'y=-1', 'z=1']))
  })
})

describe('label thinning', () => {
  it('thins 41 ticks on a 300 px edge, keeping the first and the last', () => {
    const items = Array.from({ length: 41 }, (_, i) => {
      const size = estimateLabelSize((-1 + i * 0.05).toFixed(2), 12)
      return { x: 100 + i * 7.5, y: 200, width: size.width, height: size.height }
    })
    const kept = thinLabels(items)
    expect(kept.length).toBeLessThan(41)
    expect(kept.length).toBeGreaterThan(2)
    expect(kept[0]).toBe(0)
    expect(kept[kept.length - 1]).toBe(40)
    for (let i = 1; i < kept.length; i++) expect(labelsOverlap(items[kept[i - 1]], items[kept[i]])).toBe(false)
  })

  it('keeps both end labels, symmetrically, even when the pattern does not reach the last', () => {
    // 15 labels 12 px apart, ticks k = -1 .. 13: the interior thins to a
    // common multiple of k, and both ends stay.
    const items = Array.from({ length: 15 }, (_, i) => ({ x: i * 12, y: 0, width: 22, height: 12, index: i - 1 }))
    const kept = thinLabels(items)
    expect(kept[0]).toBe(0)
    expect(kept[kept.length - 1]).toBe(14)
    expect(kept.length).toBeLessThan(15)
    for (let i = 1; i < kept.length; i++) expect(labelsOverlap(items[kept[i - 1]], items[kept[i]])).toBe(false)
    const interior = kept.slice(1, -1).map((i) => items[i].index)
    const step = interior[1] - interior[0]
    for (const k of interior) expect(Math.abs(k % step)).toBe(0)
  })

  it('an interior label crowding an end label gives way to it, and only that one', () => {
    const at = (xs: number[]) => xs.map((x, i) => ({ x, y: 0, width: 20, height: 12, index: i }))
    // The last end sits 10 px past its neighbour: only the neighbour goes.
    expect(thinLabels(at([0, 30, 60, 90, 100]))).toEqual([0, 1, 2, 4])
    // The same at the first end.
    expect(thinLabels(at([0, 10, 40, 70, 100]))).toEqual([0, 2, 3, 4])
  })

  it('keeps every label that already fits', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ x: i * 60, y: 0, width: 20, height: 12 }))
    expect(thinLabels(items)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps the first and last tick labels with authored bounds off the tick lattice', () => {
    // x in [-0.3, 2.7] with step 0.2: ticks -0.2 .. 2.6, neither on an end.
    const box: Box3 = { x: { min: -0.3, max: 2.7 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
    const world = worldMap(box, [1, 2 / 3, 2 / 3])
    const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 520, height: 420 }, 'orthographic')
    const space = defaultSpaceConfig()
    const frame = boxFrame(world, camera, frameAxes({ ...space, ticks: { ...space.ticks, x: { value: 0.2, pi: null } } }, box))
    const xs = tickLabels(frame, 'x').map((l) => l.position[0])
    expect(xs.length).toBeLessThan(15)
    expect(Math.min(...xs)).toBeCloseTo(-0.2, 12)
    expect(Math.max(...xs)).toBeCloseTo(2.6, 12)
  })

  it('thins a real edge: step 0.05 on [-1, 1] gives 41 x ticks, fewer labels, both ends kept', () => {
    const { frame } = setup(40, 25, { x: { value: 0.05, pi: null } })
    const xs = tickLabels(frame, 'x')
    expect(xs.length).toBeLessThan(41)
    const values = xs.map((l) => l.position[0])
    expect(values).toContain(-1)
    expect(values).toContain(1)
    // Every tick still gets its tick mark.
    const marks = frame.lines.filter((l) => l.role === 'tick' && l.a[0] === l.b[0] && l.a[2] === -1 && l.a[1] === 1)
    expect(marks.length).toBeGreaterThanOrEqual(41)
  })
})
