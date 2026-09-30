import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { createSpaceKernel } from './index'
import { finishMesh, gridIndices, pass2Runs, type RawMesh } from './mesh'

function sceneOf(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  const scene = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene()
  expect(scene.errors).toEqual([])
  return scene
}

// A handful of well-shaped candidate triangles (area 0.5, angles 45/45/90),
// far from any hole, so a test's median "cell" area is a realistic one, not
// skewed by the sliver(s) under test. Vertex indices start at `base`.
function normalTriangles(base: number, count: number): { positions: number[]; normals: number[]; uv: number[]; indices: number[] } {
  const positions: number[] = []
  const normals: number[] = []
  const uv: number[] = []
  const indices: number[] = []
  for (let k = 0; k < count; k++) {
    const ox = 100 * k
    const oy = 100 * k
    const v = base + 3 * k
    positions.push(ox, oy, 0, ox + 1, oy, 1, ox, oy + 1, -1)
    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1)
    uv.push(ox, oy, ox + 1, oy, ox, oy + 1)
    indices.push(v, v + 1, v + 2)
  }
  return { positions, normals, uv, indices }
}

describe('finishMesh: V8 slivers at a hole (S6 plan)', () => {
  it('drops a needle at the hole boundary by its small angle in (u, v) space, even though it is not degenerate in world space', () => {
    const normal = normalTriangles(4, 6) // vertices 4..21
    // Vertex 0 is invalid (the hole). Triangle [0, 1, 2] is cut, exposing
    // its edge (1, 2) as the hole boundary. Triangle [1, 2, 3] shares that
    // edge: in (u, v) it is a needle (base 1, height 0.001, so its base
    // angles are atan(0.001 / 0.5) ~ 0.11 degrees), but in world space its z
    // spread (5, -5, 8) keeps it well clear of the existing degenerate
    // check (cross-product magnitude ~8, nowhere near zero).
    const raw: RawMesh = {
      positions: Float64Array.from([0, 0, Number.NaN, 0, 0, 5, 1, 0, -5, 0.5, 0.001, 8, ...normal.positions]),
      normals: Float64Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, ...normal.normals]),
      uv: Float64Array.from([0, 0, 0, 0, 1, 0, 0.5, 0.001, ...normal.uv]),
      indices: Uint32Array.from([0, 1, 2, 1, 2, 3, ...normal.indices]),
    }
    const mesh = finishMesh(raw, false)
    // Positions 1 and 2 (uv (0,0) and (1,0)) survive as the hole's boundary
    // edge belongs to no surviving triangle only if the sliver [1,2,3] is
    // gone; the normal triangles are untouched (18 = 6 * 3).
    expect(mesh.indices.length).toBe(18)
  })

  it('drops a tiny, evenly-shaped triangle at the hole boundary by its area, relative to the mesh median', () => {
    const normal = normalTriangles(4, 6) // median cell area 0.5; floor = 1e-4 * 0.5 = 5e-5
    // Triangle [1, 2, 3]: side 0.01, equilateral-ish — every angle ~60
    // degrees (nowhere near the 3-degree floor), area ~= 4.3e-5, under the
    // area floor.
    const raw: RawMesh = {
      positions: Float64Array.from([0, 0, Number.NaN, 0, 0, 5, 0.01, 0, -5, 0.005, 0.00866, 8, ...normal.positions]),
      normals: Float64Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, ...normal.normals]),
      uv: Float64Array.from([0, 0, 0, 0, 0.01, 0, 0.005, 0.00866, ...normal.uv]),
      indices: Uint32Array.from([0, 1, 2, 1, 2, 3, ...normal.indices]),
    }
    const mesh = finishMesh(raw, false)
    expect(mesh.indices.length).toBe(18)
  })

  it('leaves a thin triangle alone when it does not touch a hole (a pole, or any other legitimately thin cell)', () => {
    const normal = normalTriangles(3, 6)
    // The same needle as the first test, but with no invalid vertex and no
    // dropped neighbour: nothing marks it as "on a hole".
    const raw: RawMesh = {
      positions: Float64Array.from([0, 0, 5, 1, 0, -5, 0.5, 0.001, 8, ...normal.positions]),
      normals: Float64Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, ...normal.normals]),
      uv: Float64Array.from([0, 0, 1, 0, 0.5, 0.001, ...normal.uv]),
      indices: Uint32Array.from([0, 1, 2, ...normal.indices]),
    }
    const mesh = finishMesh(raw, false)
    expect(mesh.indices.length).toBe(21) // the needle (3) plus the 6 normal triangles (18)
  })

  it('skips the sliver check when uv is not a real parameterization (implicit surfaces, parameterized = false)', () => {
    const normal = normalTriangles(4, 6)
    const raw: RawMesh = {
      positions: Float64Array.from([0, 0, Number.NaN, 0, 0, 5, 1, 0, -5, 0.5, 0.001, 8, ...normal.positions]),
      normals: Float64Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, ...normal.normals]),
      uv: new Float64Array(4 * 6 + 8), // all zero: a placeholder, not real (u, v)
      indices: Uint32Array.from([0, 1, 2, 1, 2, 3, ...normal.indices]),
    }
    expect(finishMesh(raw, false, false).indices.length).toBe(21) // the needle survives
    expect(finishMesh(raw, false, true).indices.length).toBe(18) // but not with a real uv
  })

  it('the named example — x*y/(x^2 + y^2) at the origin — draws with no sliver by the plan\'s own criteria, and stays manifold', () => {
    // The plan's test case (S6 plan V8, "Limits along two paths"). At its
    // authored resolution the singularity lands exactly on a grid vertex, so
    // every one of the 6 triangles it touches is cut whole and no candidate
    // ever borders the hole at a bad angle — this is the regression proof
    // that V8's filter is a correct no-op here, not that the example needed
    // it (it did not: rechecked below against the same 3-degree / 1e-4-area
    // criteria the filter itself uses).
    const scene = sceneOf(`@bounds3d: x [-1, 1], y [-1, 1], z [-1, 1]
f(x, y) = x*y/(x^2 + y^2)
z = f(x, y) opacity: 0.55 res: 120`)
    const mesh = scene.marks.find((m) => m.kind === 'mesh')
    if (!mesh || mesh.kind !== 'mesh') throw new Error('no mesh')
    expect(mesh.positions.every((v) => Number.isFinite(v))).toBe(true)
    const p = mesh.positions
    const idx = mesh.indices
    const edgeCount = new Map<string, number>()
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]]
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const k = u < v ? `${u}:${v}` : `${v}:${u}`
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
      }
      const P = (i: number): [number, number] => [p[3 * i], p[3 * i + 1]]
      const [ax, ay] = P(a)
      const [bx, by] = P(b)
      const [cx, cy] = P(c)
      const angleAt = (ux: number, uy: number, vx: number, vy: number) =>
        (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI
      const A = angleAt(bx - ax, by - ay, cx - ax, cy - ay)
      const B = angleAt(ax - bx, ay - by, cx - bx, cy - by)
      expect(Math.min(A, B, 180 - A - B)).toBeGreaterThanOrEqual(3)
    }
    // Manifold: every edge belongs to exactly 1 (boundary) or 2 (interior) triangles.
    expect([...edgeCount.values()].every((n) => n === 1 || n === 2)).toBe(true)
  })

  // S6 fix round 1, I4.
  it('a mesh with no hole is unchanged and skips the filter entirely: parameterized true or false gives the identical result', () => {
    const normal = normalTriangles(0, 6)
    const raw: RawMesh = {
      positions: Float64Array.from(normal.positions),
      normals: Float64Array.from(normal.normals),
      uv: Float64Array.from(normal.uv),
      indices: Uint32Array.from(normal.indices),
    }
    // No NaN vertex, so no hole edge for pass 2 to filter against — whether
    // parameterized asks for the sliver check makes no difference, since
    // I4's early return means it never actually ran either way.
    const before = pass2Runs.count
    const withCheck = finishMesh(raw, false, true)
    const without = finishMesh(raw, false, false)
    expect([...withCheck.indices]).toEqual([...without.indices])
    expect(withCheck.indices.length).toBe(raw.indices.length)
    // S6 fix round 2, item 5b: the two checks above would also pass with
    // the early return deleted — holeEdges is empty either way, so pass 2's
    // own body is a no-op that drops nothing and gives the identical
    // result. This is the one assertion that actually distinguishes "the
    // fast path ran" from "the filter ran and had nothing to do": the
    // counter must not move for either call.
    expect(pass2Runs.count).toBe(before)
  })

  it('a 20:1 domain keeps every well-shaped cell at the hole: raw (u, v) units alone would call them slivers', () => {
    // A single grid row, v in [0, 1], u in [0, 20] (20 unit-square cells:
    // "well-shaped" in grid-index space, but 20 times wider than tall in
    // raw (u, v) — the false-drop I4 fixes). Vertices (i, j), j in {0, 1},
    // i in 0..20: index j * 21 + i. Vertex (10, 0) is the hole.
    const positions: number[] = []
    const normals: number[] = []
    const uv: number[] = []
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 20; i++) {
        const isHole = i === 10 && j === 0
        positions.push(isHole ? Number.NaN : i, isHole ? Number.NaN : j, 0)
        normals.push(0, 0, 1)
        uv.push(i, j)
      }
    }
    const indices: number[] = []
    for (let i = 0; i < 20; i++) {
      const a = i
      const b = a + 1
      const d = a + 21
      const c = d + 1
      indices.push(a, b, c, a, c, d)
    }
    const raw: RawMesh = {
      positions: Float64Array.from(positions),
      normals: Float64Array.from(normals),
      uv: Float64Array.from(uv),
      indices: Uint32Array.from(indices),
    }
    // 20 cells x 2 triangles = 40; of the 3 triangles touching the hole
    // vertex (i=10, j=0), 3 are cut (cells i=9 and i=10 each contribute the
    // triangle that has it as a corner), leaving 37 candidates, all
    // well-shaped in grid-index space. Unnormalised (raw u, v: 1 wide,
    // 1 tall here — du = dv = 1), this mesh would already pass; the point
    // is that I4's normalisation is a no-op when du and dv genuinely are
    // equal, so this pins that su = sv = 1 keeps every one of the 37.
    const mesh = finishMesh(raw, false)
    expect(mesh.indices.length).toBe(37 * 3)
  })

  it('the same 20:1 case, with v itself scaled 20x: still keeps every well-shaped cell (the actual false-drop I4 fixes)', () => {
    // Same grid, but v is authored over [0, 0.05] instead of [0, 1] (a
    // genuinely 20:1 domain aspect): every cell is still a nice square in
    // grid-index (i, j) space, but in raw (u, v) units it is 20 x wider
    // than tall — exactly what used to read as a sliver.
    const positions: number[] = []
    const normals: number[] = []
    const uv: number[] = []
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 20; i++) {
        const isHole = i === 10 && j === 0
        positions.push(isHole ? Number.NaN : i, isHole ? Number.NaN : j * 0.05, 0)
        normals.push(0, 0, 1)
        uv.push(i, j * 0.05)
      }
    }
    const indices: number[] = []
    for (let i = 0; i < 20; i++) {
      const a = i
      const b = a + 1
      const d = a + 21
      const c = d + 1
      indices.push(a, b, c, a, c, d)
    }
    const raw: RawMesh = {
      positions: Float64Array.from(positions),
      normals: Float64Array.from(normals),
      uv: Float64Array.from(uv),
      indices: Uint32Array.from(indices),
    }
    const mesh = finishMesh(raw, false)
    // Before I4's grid-index normalisation, every one of these triangles'
    // (u, v)-space angles is atan(0.05 / 1) ~= 2.86 degrees at its acute
    // corners — under the 3-degree floor — so all 3 candidates that touch
    // the hole would have been dropped as false slivers. Normalised by the
    // median du = 1, dv = 0.05, they are 45/45/90 right triangles again.
    expect(mesh.indices.length).toBe(37 * 3)
  })
})

describe('the grid index cache is a small LRU (fix round 1, M5)', () => {
  it('keeps the four most recently used resolutions and evicts the oldest', () => {
    const first = gridIndices(2)
    expect(gridIndices(2)).toBe(first)
    const three = gridIndices(3)
    gridIndices(4)
    gridIndices(5)
    // using 3 makes it recent; 2 is now the least recently used
    expect(gridIndices(3)).toBe(three)
    gridIndices(6)
    // five distinct resolutions touched: 2 was evicted, 3 was not
    expect(gridIndices(2)).not.toBe(first)
    expect(gridIndices(2)).toEqual(first)
    expect(gridIndices(3)).toBe(three)
  })

  it('makes two triangles per cell, counter-clockwise in (i, j)', () => {
    // n = 1: a = 0, b = 1, d = 2, c = 3
    expect([...gridIndices(1)]).toEqual([0, 1, 3, 0, 3, 2])
  })
})
