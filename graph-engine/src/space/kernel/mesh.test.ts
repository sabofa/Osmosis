import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { createSpaceKernel } from './index'
import { iteratedSamples, rectSamples } from './domain'
import { finishMesh, gridIndices, type RawMesh } from './mesh'

function sceneOf(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  const scene = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene()
  expect(scene.errors).toEqual([])
  return scene
}

function meshOf(spec: string) {
  const scene = sceneOf(spec)
  const mesh = scene.marks.find((m) => m.kind === 'mesh')
  if (!mesh || mesh.kind !== 'mesh') throw new Error('no mesh')
  return mesh
}

// S6 fix round 4: plan V8's sliver-dropping filter (a candidate on a hole's
// boundary also dropped when it read as thin in whatever coordinates the
// pass measured — mesh.ts's own file header has the full history) is
// withdrawn. finishMesh now only ever removes a triangle that touches an
// invalid (NaN) vertex, or one that is genuinely degenerate in world space
// — never a further "sliver" reading past that. These tests are the
// no-regression net for that: every one of them is a case a previous round
// once dropped triangles from (a false positive) or was written to prove a
// true one — asserting only that the count now matches what the hole cut
// and the degenerate check alone give, with no filter beyond them.
describe('finishMesh: no hole/degenerate cut ever drops more than pass 1 alone (S6 fix round 4)', () => {
  it('a 20:1 domain keeps every well-shaped cell at the hole', () => {
    // A single grid row, v in [0, 1], u in [0, 20]. Vertices (i, j), j in
    // {0, 1}, i in 0..20: index j * 21 + i. Vertex (10, 0) is the hole.
    // Rounds 1-3 each read this in some normalised (u, v) or grid-index
    // space to avoid misreading the domain's own 20:1 aspect as a sliver;
    // round 4 removes the reading rather than fixing it again — there is
    // no measurement left to get wrong.
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
    // triangle that has it as a corner), leaving 37 candidates. No further
    // filter touches them.
    const mesh = finishMesh(raw, false)
    expect(mesh.indices.length).toBe(37 * 3)
  })

  it('the same 20:1 case, with v itself scaled 20x, still keeps every well-shaped cell', () => {
    // Same grid, but v is authored over [0, 0.05] instead of [0, 1] (a
    // genuinely 20:1 domain aspect) — exactly the shape a raw-(u, v)-space
    // reading used to misjudge as a sliver.
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
    expect(mesh.indices.length).toBe(37 * 3)
  })
})

// S6 fix round 3 found round 2's grid-step estimate wrong on a domain that
// is not a plain rectangle; round 4 found round 3's own grid-index fix
// wrong on an inequality-clipped mesh, and withdrew the whole filter these
// were all trying to fix (mesh.ts's file header). These four keep the
// region-domain regression coverage a reviewer's private probe drove that
// finding with — building each of these same four region domains with a
// hole and comparing triangle counts with the filter kept and withdrawn —
// now as a plain "the hole cut alone, nothing more" check: a hole near a
// closing corner, a pole, or the seam of a quarter annulus once lost 153,
// 127, 76 and 100 good triangles respectively to a false-positive sliver
// reading.
describe('finishMesh: region domains with a hole keep exactly what the hole cut leaves (S6 fix round 4)', () => {
  const N = 96

  function rawFrom(samples: ReturnType<typeof rectSamples>, hole: (x: number, y: number) => boolean): RawMesh {
    const count = samples.x.length
    const positions = new Float64Array(3 * count)
    const normals = new Float64Array(3 * count)
    const uv = new Float64Array(2 * count)
    for (let v = 0; v < count; v++) {
      const x = samples.x[v]
      const y = samples.y[v]
      const inHole = hole(x, y)
      positions[3 * v] = inHole ? Number.NaN : x
      positions[3 * v + 1] = inHole ? Number.NaN : y
      positions[3 * v + 2] = inHole ? Number.NaN : 1 + x * y
      normals[3 * v + 2] = 1
      uv[2 * v] = x
      uv[2 * v + 1] = y
    }
    return { positions, normals, uv, indices: samples.indices }
  }

  const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 < r * r

  // Each expected count below is what finishMesh actually gives with no
  // filter beyond the hole cut and the pre-existing degenerate check — not
  // simply "every triangle missing the artificial hole": the type I domains
  // close to a single point at one end (y in [0, x] and y in [x^2, x] both
  // meet at x = 0), so a handful of triangles there are genuinely
  // degenerate in world space, on top of whatever the hole itself removes.
  // A pinned count catches a regression in either check, not just a
  // reintroduced sliver filter.
  function keepsExactly(samples: ReturnType<typeof rectSamples>, hole: (x: number, y: number) => boolean, expected: number) {
    const raw = rawFrom(samples, hole)
    const mesh = finishMesh(raw, true)
    expect(mesh.indices.length / 3).toBe(expected)
  }

  it('type I region y in [0, x], x in [0, 1]: a hole near the closing corner', () => {
    const samples = iteratedSamples({ outer: 'x', outerRange: { min: 0, max: 1 }, lo: () => 0, hi: (x) => x, polar: null, outerIsX: true }, N)
    keepsExactly(samples, disk(0.6, 0.3, 0.12), 16815)
  })

  it('type I region y in [x^2, x], x in [0, 1]: a hole near the closing corner', () => {
    const samples = iteratedSamples({ outer: 'x', outerRange: { min: 0, max: 1 }, lo: (x) => x * x, hi: (x) => x, polar: null, outerIsX: true }, N)
    keepsExactly(samples, disk(0.5, 0.35, 0.06), 17259)
  })

  it('polar r in [0, 2], theta in [0, 2pi]: a hole near the pole', () => {
    const samples = iteratedSamples(
      { outer: 'r', outerRange: { min: 0, max: 2 }, lo: () => 0, hi: () => 2 * Math.PI, polar: { outerIsR: true, angle: 1 }, outerIsX: false },
      N
    )
    keepsExactly(samples, disk(0.8, 0.5, 0.35), 17633)
  })

  it('the quarter annulus, r in [1, 2], theta in [0, pi/2]', () => {
    const samples = iteratedSamples(
      { outer: 'r', outerRange: { min: 1, max: 2 }, lo: () => 0, hi: () => Math.PI / 2, polar: { outerIsR: true, angle: 1 }, outerIsX: false },
      N
    )
    // No closing corner here (r never reaches 0), so this count is exactly
    // "every triangle missing the hole", nothing else.
    keepsExactly(samples, disk(1, 1, 0.2), 17298)
  })
})

// S6 fix round 3's own end-to-end regression coverage, kept as a plain
// no-regression count now that there is no filter left to name a round
// after.
describe('finishMesh: end-to-end region specs keep every triangle the hole cut leaves (S6 fix round 4)', () => {
  it('z = sqrt(r - 1.5) over r in [1, 2], theta in [0, pi/2] gives 9216 triangles', () => {
    expect(meshOf('z = sqrt(r - 1.5) over r in [1, 2], theta in [0, pi/2] res: 96').indices.length / 3).toBe(9216)
  })

  it('z = 1 / sqrt(x - 0.5) over x in [0, 1], y in [0, x] gives 9024 triangles', () => {
    expect(meshOf('z = 1 / sqrt(x - 0.5) over x in [0, 1], y in [0, x] res: 96').indices.length / 3).toBe(9024)
  })
})

// The smallest angle (degrees) among every triangle, measured on the
// parameter grid (mesh.uv), not world space: for a plain rectangular or
// iterated domain, gridIndices' own two canonical cell triangles are
// exactly a 1x1 right triangle in (u, v) steps — 45/45/90 — whatever the
// surface curves into in world space (mesh.ts's file header, fix round 4).
function minAngleDeg(mesh: { uv: Float64Array | null; indices: Uint32Array }): number {
  if (!mesh.uv) throw new Error('mesh has no uv')
  const uv = mesh.uv
  const angleAt = (ux: number, uy: number, vx: number, vy: number) => (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI
  let min = Infinity
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
    const [ax, ay, bx, by, cx, cy] = [uv[2 * a], uv[2 * a + 1], uv[2 * b], uv[2 * b + 1], uv[2 * c], uv[2 * c + 1]]
    const angleA = angleAt(bx - ax, by - ay, cx - ax, cy - ay)
    const angleB = angleAt(ax - bx, ay - by, cx - bx, cy - by)
    min = Math.min(min, angleA, angleB, 180 - angleA - angleB)
  }
  return min
}

// Restores end-to-end coverage for the example that motivated V8 in the
// first place (mesh.ts's file header, "Limits along two paths"): a plain
// rectangular domain with one pole hole at the origin, no inequality clip
// anywhere — exactly the case fix round 4 says stays a clean 45/45/90 grid
// with no genuine sliver for V8 to have caught.
describe('finishMesh: "Limits along two paths" keeps a clean 45/45/90 grid at its pole hole (S6 fix round 4)', () => {
  it('z = x*y/(x^2 + y^2) over x, y in [-1, 1] at res 120 gives 28794 triangles, none a sliver', () => {
    const mesh = meshOf('z = x*y/(x^2 + y^2) res: 120')
    expect(mesh.indices.length / 3).toBe(28794)
    expect(minAngleDeg(mesh)).toBeCloseTo(45, 9)
  })
})

// S6 fix round 4: an inequality-clipped domain's boundary cells do not
// carry the two-triangle-per-cell topology round 3's grid-index reading
// assumed — misread, that gave every hole-edge triangle an enormous row
// width, collapsing them onto one row (every one "collinear", so every one
// dropped): `z = sqrt(x^2 + y^2 - 1) over y <= x` fell to 8856 triangles,
// against 8890 with no filter; the volume under it fell to 18621, against
// 18655. No coordinate reading survives here at all, so nothing is left to
// misread.
describe('finishMesh: inequality-domain end-to-end specs keep every triangle (S6 fix round 4)', () => {
  it('z = sqrt(x^2 + y^2 - 1) over y <= x gives 8890 triangles', () => {
    expect(meshOf('z = sqrt(x^2 + y^2 - 1) over y <= x').indices.length / 3).toBe(8890)
  })

  it('volume: under sqrt(x^2 + y^2 - 1) + 1 over y <= x gives 18655 triangles', () => {
    // The integral itself is refused (the integrand is undefined inside
    // the unit disk, which the domain's default box reaches) — the mesh
    // still draws, and scene.errors carries the refusal; sceneOf's own
    // "no errors" check does not fit this one spec, so this reads the
    // scene directly instead, the same way the round-4 report's own
    // reproduction did (parseSpec -> createSpaceKernel -> scene, tallying
    // every mesh mark, errors or not).
    //
    // One more than the round-4 report's own cited 18654: that count came
    // from a probe copy of the mesh builder that still carries V8's
    // original, unnormalised filter — confirmed directly (swapping it in
    // for ./kernel/mesh reproduces exactly 18654 here). It drops one
    // genuine boundary triangle on this spec that this withdrawal
    // (mesh.ts's own file header) now correctly keeps — precisely the
    // "dropping a clipped boundary sliver opens a gap in the surface"
    // reason the ruling gives for withdrawing V8 rather than fixing it a
    // fourth time. 18655 is what no sliver filter, of any kind, gives.
    const parsed = parseSpec('volume: under sqrt(x^2 + y^2 - 1) + 1 over y <= x')
    expect(parsed.errors).toEqual([])
    const scene = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene()
    let total = 0
    for (const m of scene.marks) if (m.kind === 'mesh') total += m.indices.length / 3
    expect(total).toBe(18655)
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
