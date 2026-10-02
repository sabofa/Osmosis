import { describe, expect, it } from 'vitest'
import { createContext } from '../../gl/context'
import { meshMark, scene } from '../../testing/marks'
import { isDrawableMesh, relativePositions, sceneBounds, uploadScene } from './meshes'
import { createPaintFakeGl } from './fakePaintGl'
import { Resources } from './resources'

const square = (z: number, x0 = 0, opacity = 1) =>
  meshMark([x0, 0, z, x0 + 2, 0, z, x0 + 2, 2, z, x0, 2, z], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2, 0, 2, 3], { style: { opacity } })

describe('which meshes draw', () => {
  it('draws opaque meshes only: opacity 0.5 is a glaze for the model, not geometry', () => {
    expect(isDrawableMesh(square(0))).toBe(true)
    expect(isDrawableMesh(square(0, 0, 0.5))).toBe(false)
  })

  it('does not draw a mesh with no triangle', () => {
    expect(isDrawableMesh(meshMark([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], []))).toBe(false)
  })
})

describe('the scene bounds', () => {
  it('takes the box centre and the farthest vertex of the drawn meshes: a square at z 0 and one at z 2 -> centre (1, 1, 1), radius sqrt(3)', () => {
    const b = sceneBounds(scene([square(0), square(2)]))
    expect(b.origin).toEqual([1, 1, 1])
    expect(b.radius).toBeCloseTo(Math.sqrt(3), 9)
  })

  it('ignores a translucent mesh far away', () => {
    const b = sceneBounds(scene([square(0), square(0, 100, 0.4)]))
    expect(b.origin).toEqual([1, 1, 0])
    expect(b.radius).toBeCloseTo(Math.SQRT2, 9)
  })

  it('an empty scene has the unit sphere at the origin', () => {
    expect(sceneBounds(scene([]))).toEqual({ origin: [0, 0, 0], radius: 1 })
  })
})

describe('positions relative to the origin', () => {
  it('keeps precision far from zero: x = 4500.25 about 4500 is 0.25 exactly in Float32', () => {
    const out = relativePositions(Float64Array.from([4500.25, 7, 3]), [4500, 7, 3])
    expect(Array.from(out)).toEqual([0.25, 0, 0])
  })
})

describe('uploadScene', () => {
  it('uploads one VAO per drawable mesh, keyed by its index in scene.marks, positions relative to the origin', () => {
    const paint = createPaintFakeGl()
    const ctx = createContext(paint.canvas.canvas)
    if ('error' in ctx) throw new Error(ctx.error)
    const gl = ctx.gl
    const res = new Resources(gl)
    // marks: 0 opaque, 1 translucent (skipped), 2 opaque
    const gpu = uploadScene(gl, res, scene([square(0), square(1, 0, 0.5), square(2)]))
    expect(gpu.meshes.map((m) => m.mark)).toEqual([0, 2])
    expect(gpu.meshes.every((m) => m.count === 6)).toBe(true)
    expect(gpu.origin).toEqual([1, 1, 1])
    // The first mesh's position buffer holds (x - 1, y - 1, z - 1).
    const positions = paint.fake.uploads.find((u) => u.target === 0x8892 && u.data instanceof Float32Array && u.data.length === 12)
    expect(Array.from(positions?.data ?? []).slice(0, 3)).toEqual([-1, -1, -1])
    // Two VAOs, and disposing frees them all.
    expect(paint.fake.created.vertexArray).toBe(2)
    res.disposeAll()
    expect(paint.fake.deleted.vertexArray).toBe(2)
    expect(paint.fake.deleted.buffer).toBe(paint.fake.created.buffer)
  })
})
