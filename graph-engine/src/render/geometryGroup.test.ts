import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GeometryGroupManager } from './geometryGroup'
import type { GeometryItem } from './renderItems'
import type { Vec2 } from '../scene/types'

const palette = { curve: 0x2f5fd0, segment: 0x1f8f5f, region: 0x2f5fd0, background: 0xfdf6ea, axis: 0x17170f }
// A simple, non-zoom-dependent stand-in for SceneRenderer's real
// pixelToWorld (px * viewHeight / canvasHeightPx) — the exact scale factor
// doesn't matter for these tests, only that widths come out positive and
// comparable to each other.
const pixelToWorld = (px: number) => px * 0.01

describe('GeometryGroupManager', () => {
  // Regression test for a real bug found while splitting SceneRenderer.ts
  // apart: growAttribute's "buffer needs to grow" branch used to build the
  // new attribute with THREE.Float32BufferAttribute, whose constructor
  // always copies its input array rather than wrapping it by reference. That
  // silently disconnected the array growAttribute handed back to the caller
  // from the one actually attached to the geometry, so every write the
  // caller made afterward went nowhere — the geometry kept rendering its
  // *previous* (stale) shape. This is exactly the transition GraphViewer
  // triggers every time a drag ends (the coarse quality -> the full quality,
  // a big jump in vertex count for a region/implicit curve).
  it('reflects new point data after a curve object grows past its initial buffer size', () => {
    const mgr = new GeometryGroupManager()
    const small: GeometryItem = { kind: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }], color: null }
    mgr.update([small], palette, pixelToWorld)
    const objectBefore = mgr.group.children[0]

    const grown: GeometryItem = {
      kind: 'curve',
      points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }, { x: 1, y: 1 }, { x: 1.5, y: 2.25 }, { x: 2, y: 4 }],
      color: null,
    }
    mgr.update([grown], palette, pixelToWorld)
    const objectAfter = mgr.group.children[0] as THREE.Mesh

    // Same THREE object reused in place (the whole point of this update
    // path), but its buffer must actually reflect the grown point set. A
    // curve renders as a ribbon (left/right offset pairs per point, see
    // computeCurveWidths) rather than a plain polyline, so recover each
    // sample's centerline by averaging its left/right pair — that's exactly
    // the original point regardless of the computed width.
    expect(objectAfter).toBe(objectBefore)
    const positions = objectAfter.geometry.getAttribute('position').array
    if (grown.kind !== 'curve') throw new Error('unreachable')
    grown.points.forEach((p, i) => {
      const li = i * 2
      const ri = i * 2 + 1
      const midX = (positions[li * 3] + positions[ri * 3]) / 2
      const midY = (positions[li * 3 + 1] + positions[ri * 3 + 1]) / 2
      expect(midX).toBeCloseTo(p.x, 5)
      expect(midY).toBeCloseTo(p.y, 5)
    })
  })

  // The headline feature of the ribbon rendering: width tapers with local
  // curvature, like an artist easing off the pen on a straight run and
  // pressing harder through a turn.
  it('widens the ribbon through a sharp turn relative to a straight run', () => {
    const mgr = new GeometryGroupManager()
    const points: Vec2[] = []
    for (let i = 0; i <= 20; i++) points.push({ x: i, y: 0 })
    for (let i = 1; i <= 20; i++) points.push({ x: 20 + i * Math.cos(2.5), y: i * Math.sin(2.5) })
    const obj: GeometryItem = { kind: 'curve', points, color: null }
    mgr.update([obj], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    const positions = mesh.geometry.getAttribute('position').array

    function widthAt(i: number): number {
      const li = i * 2
      const ri = i * 2 + 1
      const dx = positions[li * 3] - positions[ri * 3]
      const dy = positions[li * 3 + 1] - positions[ri * 3 + 1]
      return Math.hypot(dx, dy)
    }

    const straightWidth = widthAt(10) // well within the straight run
    const turnWidth = widthAt(20) // right at the sharp bend
    expect(turnWidth).toBeGreaterThan(straightWidth)
  })

  // Regression test for a real bug: a scatter plot's regression line is
  // built as a 2-point straight "curve" (see buildScene.ts's buildScatter).
  // With only 2 points, computeCurveWidths's neighbor-lookup clamps straight
  // back onto the point itself at both ends, and atan2(0, 0) on that
  // zero-length leg used to read as a sharp turn — so a perfectly straight
  // line rendered at near-maximum ribbon width instead of the thin weight a
  // zero-curvature run should get.
  it('renders a 2-point straight line at minimum width, not maximum', () => {
    const mgr = new GeometryGroupManager()
    const obj: GeometryItem = { kind: 'curve', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], color: null }
    mgr.update([obj], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    const positions = mesh.geometry.getAttribute('position').array

    function widthAt(i: number): number {
      const li = i * 2
      const ri = i * 2 + 1
      const dx = positions[li * 3] - positions[ri * 3]
      const dy = positions[li * 3 + 1] - positions[ri * 3 + 1]
      return Math.hypot(dx, dy)
    }

    // Minimum width at t=0: CURVE_BASE_WIDTH_PX * 0.5 * (1 - 0.85) + 1, in
    // world units via the test's pixelToWorld (px * 0.01).
    const expectedMinWidth = (3 * 0.5 * (1 - 0.85) + 1) * 0.01
    expect(widthAt(0)).toBeCloseTo(expectedMinWidth, 5)
    expect(widthAt(1)).toBeCloseTo(expectedMinWidth, 5)
  })

  // Regression test for a real, visible bug: a ribbon is an *indexed*
  // geometry (two triangles per segment via an index buffer), but
  // setDrawRange's count means "how many indices" once a geometry is
  // indexed — not "how many vertices" the way it does for every other kind
  // built here. Passing the vertex count truncated every ribbon to roughly
  // its first third on every in-place update (i.e. on every pan/zoom/drag,
  // and any rebuild after the very first one), which read as "the curve
  // just cuts off partway across the screen."
  it('draws the full ribbon, not just a leading fraction of it, after an in-place update', () => {
    const mgr = new GeometryGroupManager()
    const points: Vec2[] = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * i }))
    mgr.update([{ kind: 'curve', points, color: null }], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    expect(mesh.geometry.drawRange.count).toBe((points.length - 1) * 6)

    const morePoints: Vec2[] = Array.from({ length: 50 }, (_, i) => ({ x: i, y: -i * i }))
    mgr.update([{ kind: 'curve', points: morePoints, color: null }], palette, pixelToWorld)
    expect(mesh.geometry.drawRange.count).toBe((morePoints.length - 1) * 6)
  })

  // Same buffer-reuse idea as growAttribute, applied to the ribbon's index
  // (topology) buffer: rebuilding it is unnecessary — and, during a drag,
  // exactly the kind of per-frame GPU buffer churn growAttribute exists to
  // avoid — when the point count hasn't actually changed between rebuilds.
  it('reuses the index buffer across an update that keeps the same point count', () => {
    const mgr = new GeometryGroupManager()
    const pointsA: Vec2[] = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * i }))
    const pointsB: Vec2[] = Array.from({ length: 10 }, (_, i) => ({ x: i, y: -i * i }))
    mgr.update([{ kind: 'curve', points: pointsA, color: null }], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    const indexBefore = mesh.geometry.index
    mgr.update([{ kind: 'curve', points: pointsB, color: null }], palette, pixelToWorld)
    expect(mesh.geometry.index).toBe(indexBefore)
  })

  // Dashed segments render as quads (see splitIntoDashChunks), not a plain
  // polyline, so growth is checked by distance-to-path rather than an exact
  // vertex index — every drawn vertex of a dash quad sits within halfWidth
  // of the segment it belongs to.
  it('also reflects grown data for a dashed segments batch (the region-boundary case)', () => {
    const mgr = new GeometryGroupManager()
    const small: GeometryItem = { kind: 'segments', pairs: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]], dashed: true, color: null }
    mgr.update([small], palette, pixelToWorld)

    // Geometrically disjoint from "small" (far away) so any stale leftover
    // vertices from the smaller buffer would clearly fail this check instead
    // of coincidentally passing because the paths overlap.
    const grown: GeometryItem = {
      kind: 'segments',
      pairs: [
        [{ x: 100, y: 100 }, { x: 101, y: 100 }],
        [{ x: 101, y: 100 }, { x: 102, y: 101 }],
        [{ x: 102, y: 101 }, { x: 103, y: 103 }],
      ],
      dashed: true,
      color: null,
    }
    mgr.update([grown], palette, pixelToWorld)
    const obj = mgr.group.children[0] as THREE.Mesh
    const positions = obj.geometry.getAttribute('position').array
    const quadCount = obj.geometry.drawRange.count / 6
    expect(quadCount).toBeGreaterThan(0)

    function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
      const dx = bx - ax
      const dy = by - ay
      const lenSq = dx * dx + dy * dy
      const t = Math.max(0, Math.min(1, lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq))
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
    }

    const halfWidth = pixelToWorld(2.5) / 2 + 1e-6
    for (let i = 0; i < quadCount * 4; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const dists = grown.pairs.map(([a, b]) => distToSegment(x, y, a.x, a.y, b.x, b.y))
      expect(Math.min(...dists)).toBeLessThan(halfWidth + 0.01)
    }
  })

  it('reallocates the quad index buffer only when capacity grows, and always draws exactly the current quads', () => {
    const mgr = new GeometryGroupManager()
    const batch = (n: number): GeometryItem => ({
      kind: 'segments',
      pairs: Array.from({ length: n }, (_, i) => [{ x: i, y: 0 }, { x: i + 0.5, y: 1 }] as [Vec2, Vec2]),
      dashed: false,
      color: null,
    })
    const seen = new Set<unknown>()
    for (const n of [10, 12, 9, 30, 31, 8, 64]) {
      mgr.update([batch(n)], palette, pixelToWorld)
      const mesh = mgr.group.children[0] as THREE.Mesh
      seen.add(mesh.geometry.index)
      expect(mesh.geometry.drawRange.count).toBe(n * 6)
      expect(mesh.geometry.index!.count).toBeGreaterThanOrEqual(n * 6)
      // The drawn prefix is still the right quad topology.
      const idx = mesh.geometry.index!.array
      const last = n - 1
      expect(Array.from(idx.slice(last * 6, last * 6 + 6))).toEqual([last * 4, last * 4 + 1, last * 4 + 2, last * 4 + 1, last * 4 + 3, last * 4 + 2])
    }
    // Capacity doubles: 10 -> 20 -> 40 -> 80 (or exact fit when a jump exceeds 2x); never one per change.
    expect(seen.size).toBeLessThanOrEqual(4)
  })

  it('gives a dashed segment real gaps instead of one solid weighted line', () => {
    const mgr = new GeometryGroupManager()
    // Long enough (5 world units, vs. a 0.12+0.09 dash+gap period) to produce
    // several dash chunks with real gaps between them.
    const obj: GeometryItem = { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, dashed: true, color: null }
    mgr.update([obj], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    const quadCount = mesh.geometry.drawRange.count / 6
    expect(quadCount).toBeGreaterThan(5)

    // Consecutive quads' x-extents shouldn't touch — there must be a gap.
    const positions = mesh.geometry.getAttribute('position').array
    const xExtents: [number, number][] = []
    for (let i = 0; i < quadCount; i++) {
      const xs = [0, 1, 2, 3].map((v) => positions[(i * 4 + v) * 3])
      xExtents.push([Math.min(...xs), Math.max(...xs)])
    }
    xExtents.sort((a, b) => a[0] - b[0])
    for (let i = 0; i < xExtents.length - 1; i++) {
      expect(xExtents[i + 1][0]).toBeGreaterThan(xExtents[i][1])
    }
  })

  // Regression test for a real, measured bug: dash/gap length used to be a
  // fixed *world*-unit size (0.12/0.09), so a dashed line's chunk count
  // scaled with its length in world units rather than its length on screen.
  // A dashed line spanning the full camera bounds height (an asymptote guide
  // at deep zoom-out) is thousands of world
  // units — producing tens of thousands of quads, rebuilt on every pan/zoom
  // frame. This measured 150-330ms per frame in the real app. Two
  // properties must hold: dash count stays bounded by MAX_DASH_CHUNKS no
  // matter how long the segment is in world units, AND — the actual fix,
  // not just the backstop — a *more zoomed-out* pixelToWorld (bigger world-
  // units-per-pixel) produces proportionally *fewer* chunks for the same
  // segment, matching the "fixed on-screen size" convention every other
  // dash/width/marker constant in this file already follows.
  it('bounds a dashed segment spanning thousands of world units instead of scaling chunk count with world length', () => {
    const mgr = new GeometryGroupManager()
    const far = 5000
    const obj: GeometryItem = { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 0, y: far }, dashed: true, color: null }

    const t0 = performance.now()
    mgr.update([obj], palette, pixelToWorld)
    const elapsedMs = performance.now() - t0

    const mesh = mgr.group.children[0] as THREE.Mesh
    const quadCount = mesh.geometry.drawRange.count / 6
    expect(quadCount).toBeGreaterThan(0)
    expect(quadCount).toBeLessThanOrEqual(2000) // MAX_DASH_CHUNKS backstop
    expect(elapsedMs).toBeLessThan(200) // was 150-330ms+ before the fix

    // The actual fix, isolated from the backstop: a coarser (more zoomed
    // out) pixelToWorld must produce meaningfully fewer chunks for the
    // *same* 5000-unit segment, since the dash size in world units grows
    // with it. A fixed-world-unit dash size (the old bug) would produce the
    // exact same count regardless of zoom.
    const zoomedOutMgr = new GeometryGroupManager()
    const zoomedOutPixelToWorld = (px: number) => px * 5 // 500x coarser than pixelToWorld's 0.01
    zoomedOutMgr.update([obj], palette, zoomedOutPixelToWorld)
    const zoomedOutMesh = zoomedOutMgr.group.children[0] as THREE.Mesh
    const zoomedOutQuadCount = zoomedOutMesh.geometry.drawRange.count / 6
    expect(zoomedOutQuadCount).toBeLessThan(quadCount / 10)
  })

  it('renders a non-dashed segments batch as one quad per pair with no gap-splitting', () => {
    const mgr = new GeometryGroupManager()
    const obj: GeometryItem = {
      kind: 'segments',
      pairs: [
        [{ x: 0, y: 0 }, { x: 5, y: 0 }],
        [{ x: 0, y: 1 }, { x: 5, y: 1 }],
      ],
      color: null,
    }
    mgr.update([obj], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    expect(mesh.geometry.drawRange.count / 6).toBe(2) // exactly one quad per pair
  })

  describe('a dashed curve', () => {
    // The mesh's quads, each as its x and y extent; a dash of a curve is several quads end to end, one per
    // stretch of polyline it covers, so a dash is a run of quads whose extents touch
    function quadsOf(mesh: THREE.Mesh) {
      const positions = mesh.geometry.getAttribute('position').array
      const quadCount = mesh.geometry.drawRange.count / 6
      const quads: { xs: number[]; ys: number[] }[] = []
      for (let q = 0; q < quadCount; q++) {
        const xs = [0, 1, 2, 3].map((v) => positions[(q * 4 + v) * 3])
        const ys = [0, 1, 2, 3].map((v) => positions[(q * 4 + v) * 3 + 1])
        quads.push({ xs, ys })
      }
      return quads
    }

    // the runs of consecutive quads along x: [start, end] of each dash
    function dashesAlongX(mesh: THREE.Mesh): [number, number][] {
      const spans = quadsOf(mesh)
        .map((q) => [Math.min(...q.xs), Math.max(...q.xs)] as [number, number])
        .sort((a, b) => a[0] - b[0])
      const dashes: [number, number][] = []
      for (const span of spans) {
        const last = dashes[dashes.length - 1]
        if (last && span[0] - last[1] < 1e-9) last[1] = Math.max(last[1], span[1])
        else dashes.push([span[0], span[1]])
      }
      return dashes
    }

    const along = (n: number, length: number): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: (length * i) / (n - 1), y: 0 }))

    it('is drawn as dashes with gaps between them, not one solid ribbon', () => {
      const mgr = new GeometryGroupManager()
      mgr.update([{ kind: 'curve', points: along(101, 5), dashed: true, color: null }], palette, pixelToWorld)
      const mesh = mgr.group.children[0] as THREE.Mesh
      const dashes = dashesAlongX(mesh)
      // 5 units at a 7 px dash and a 5 px gap, 0.01 units to a pixel: a period of 0.12, so a dash starts at each
      // multiple of it up to 4.92 (42 of them), the last ending at 4.99, short of the end
      expect(dashes).toHaveLength(42)
      for (const [start, end] of dashes) expect(end - start).toBeCloseTo(0.07, 5)
      for (let i = 0; i < dashes.length - 1; i++) expect(dashes[i + 1][0] - dashes[i][1]).toBeCloseTo(0.05, 5)
      expect(dashes[0][0]).toBeCloseTo(0, 5)
      // a set of quads, each of its own four vertices, at least one to a dash: not the solid curve's ribbon
      // of two vertices a point, whose 100 segments are 600 indices that no gap interrupts
      expect(mesh.geometry.drawRange.count % 6).toBe(0)
      expect(quadsOf(mesh).length).toBeGreaterThanOrEqual(dashes.length)
      const solid = new GeometryGroupManager()
      solid.update([{ kind: 'curve', points: along(101, 5), color: null }], palette, pixelToWorld)
      expect((solid.group.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(100 * 6)
    })

    it('runs one dash and gap pattern along the whole polyline, whatever its vertex spacing', () => {
      const few = new GeometryGroupManager()
      few.update([{ kind: 'curve', points: along(2, 5), dashed: true, color: null }], palette, pixelToWorld)
      const many = new GeometryGroupManager()
      many.update([{ kind: 'curve', points: along(1001, 5), dashed: true, color: null }], palette, pixelToWorld)
      const a = dashesAlongX(few.group.children[0] as THREE.Mesh)
      const b = dashesAlongX(many.group.children[0] as THREE.Mesh)
      expect(b).toHaveLength(a.length)
      a.forEach(([start, end], i) => {
        expect(b[i][0]).toBeCloseTo(start, 5)
        expect(b[i][1]).toBeCloseTo(end, 5)
      })
    })

    it('follows the curve round a bend and keeps the dash weight of a dashed segment', () => {
      const mgr = new GeometryGroupManager()
      // a quarter circle of radius 3 and then a straight run off it
      const arc: Vec2[] = Array.from({ length: 121 }, (_, i) => ({ x: 3 * Math.cos((Math.PI / 2) * (i / 120)), y: 3 * Math.sin((Math.PI / 2) * (i / 120)) }))
      const points = [...arc, { x: 0, y: 6 }, { x: -3, y: 6 }]
      mgr.update([{ kind: 'curve', points, dashed: true, color: null }], palette, pixelToWorld)
      const mesh = mgr.group.children[0] as THREE.Mesh
      const halfWidth = pixelToWorld(2.5) / 2
      const near = (x: number, y: number) => {
        let best = Infinity
        for (let i = 0; i + 1 < points.length; i++) {
          const [a, b] = [points[i], points[i + 1]]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const lenSq = dx * dx + dy * dy
          const t = Math.max(0, Math.min(1, lenSq === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / lenSq))
          best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)))
        }
        return best
      }
      const quads = quadsOf(mesh)
      expect(quads.length).toBeGreaterThan(10)
      let drawn = 0
      for (const q of quads) {
        // every corner of every quad is within half the weight of the polyline, the weight of a dashed segment
        q.xs.forEach((x, v) => expect(near(x, q.ys[v])).toBeLessThan(halfWidth + 1e-5))
        expect(Math.hypot(q.xs[0] - q.xs[1], q.ys[0] - q.ys[1])).toBeCloseTo(2 * halfWidth, 5)
        // a quad's length: from the middle of its start edge to the middle of its end edge
        drawn += Math.hypot((q.xs[2] + q.xs[3] - q.xs[0] - q.xs[1]) / 2, (q.ys[2] + q.ys[3] - q.ys[0] - q.ys[1]) / 2)
      }
      // and the dashes cover 7 of every 12 px along the polyline, from its start, with the gaps between them left out
      let length = 0
      for (let i = 0; i + 1 < points.length; i++) length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
      const period = 0.12
      const periods = Math.floor(length / period)
      expect(drawn).toBeCloseTo(periods * 0.07 + Math.min(0.07, length - periods * period), 3)
    })

    it('reflects new points after an in-place update, and rebuilds when it becomes solid', () => {
      const mgr = new GeometryGroupManager()
      mgr.update([{ kind: 'curve', points: along(5, 1), dashed: true, color: null }], palette, pixelToWorld)
      const before = mgr.group.children[0] as THREE.Mesh
      // far from where it was, and much longer, so the buffers must grow and none of the old data may show
      const moved: Vec2[] = Array.from({ length: 50 }, (_, i) => ({ x: 100 + i * 0.1, y: 100 }))
      mgr.update([{ kind: 'curve', points: moved, dashed: true, color: null }], palette, pixelToWorld)
      const after = mgr.group.children[0] as THREE.Mesh
      expect(after).toBe(before)
      for (const q of quadsOf(after)) {
        for (const x of q.xs) expect(x).toBeGreaterThan(99.9)
        for (const y of q.ys) expect(Math.abs(y - 100)).toBeLessThan(pixelToWorld(2.5))
      }
      mgr.update([{ kind: 'curve', points: moved, color: null }], palette, pixelToWorld)
      expect(mgr.group.children[0]).not.toBe(before)
      expect((mgr.group.children[0] as THREE.Mesh).geometry.drawRange.count).toBe((moved.length - 1) * 6)
    })

    it('bounds its dashes however long the curve is in world units, and makes fewer of them zoomed out', () => {
      const far = along(2, 5000)
      const mgr = new GeometryGroupManager()
      mgr.update([{ kind: 'curve', points: far, dashed: true, color: null }], palette, pixelToWorld)
      const dashes = dashesAlongX(mgr.group.children[0] as THREE.Mesh).length
      // 5000 units is some 40,000 dashes at this zoom; the backstop (as for a segment) stops at 2000
      expect(dashes).toBe(2000)
      const zoomedOut = new GeometryGroupManager()
      zoomedOut.update([{ kind: 'curve', points: far, dashed: true, color: null }], palette, (px) => px * 5)
      expect(dashesAlongX(zoomedOut.group.children[0] as THREE.Mesh).length).toBeLessThan(dashes / 10)
    })
  })

  // The legacy triangle region (the old marching-squares path) and a band both reach the renderer as this fill.
  it('draws a triangle fill as the triangles given, behind the curves, translucent', () => {
    const mgr = new GeometryGroupManager()
    const triangles: Vec2[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]
    mgr.update([{ kind: 'region', triangles, color: null }], palette, pixelToWorld)
    const mesh = mgr.group.children[0] as THREE.Mesh
    const positions = mesh.geometry.getAttribute('position').array
    triangles.forEach((p, i) => {
      expect(positions[i * 3]).toBe(p.x)
      expect(positions[i * 3 + 1]).toBe(p.y)
      expect(positions[i * 3 + 2]).toBeCloseTo(-0.05, 6)
    })
    expect(mesh.geometry.getAttribute('position').count).toBe(6)
    expect(mesh.geometry.index).toBeNull()
    const material = mesh.material as THREE.MeshBasicMaterial
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeCloseTo(0.18, 6)
  })

  it('shrinks the draw range without needing to reallocate when the object count decreases', () => {
    const mgr = new GeometryGroupManager()
    mgr.update(
      [
        { kind: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: null },
        { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: null },
      ],
      palette,
      pixelToWorld
    )
    expect(mgr.group.children.length).toBe(2)
    mgr.update([{ kind: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: null }], palette, pixelToWorld)
    expect(mgr.group.children.length).toBe(1)
  })

  it('disposes and rebuilds fresh when a kind changes at the same index', () => {
    const mgr = new GeometryGroupManager()
    mgr.update([{ kind: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: null }], palette, pixelToWorld)
    const before = mgr.group.children[0]
    mgr.update([{ kind: 'segment', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: null }], palette, pixelToWorld)
    const after = mgr.group.children[0]
    expect(after).not.toBe(before)
  })
})
