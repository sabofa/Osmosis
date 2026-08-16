import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GeometryGroupManager, isGeometryKind } from './geometryGroup'
import type { SceneObject, Vec2 } from '../scene/types'

const palette = { curve: 0x2f5fd0, segment: 0x1f8f5f, region: 0x2f5fd0 }
// A simple, non-zoom-dependent stand-in for SceneRenderer's real
// pixelToWorld (px * viewHeight / canvasHeightPx) — the exact scale factor
// doesn't matter for these tests, only that widths come out positive and
// comparable to each other.
const pixelToWorld = (px: number) => px * 0.01

describe('isGeometryKind', () => {
  it('classifies curve/segment/segments/region as geometry kinds and everything else as not', () => {
    expect(isGeometryKind('curve')).toBe(true)
    expect(isGeometryKind('segment')).toBe(true)
    expect(isGeometryKind('segments')).toBe(true)
    expect(isGeometryKind('region')).toBe(true)
    expect(isGeometryKind('point')).toBe(false)
    expect(isGeometryKind('ray')).toBe(false)
    expect(isGeometryKind('animatedPoint')).toBe(false)
  })
})

describe('GeometryGroupManager', () => {
  // Regression test for a real bug found while splitting SceneRenderer.ts
  // apart: growAttribute's "buffer needs to grow" branch used to build the
  // new attribute with THREE.Float32BufferAttribute, whose constructor
  // always copies its input array rather than wrapping it by reference. That
  // silently disconnected the array growAttribute handed back to the caller
  // from the one actually attached to the geometry, so every write the
  // caller made afterward went nowhere — the geometry kept rendering its
  // *previous* (stale) shape. This is exactly the transition GraphViewer
  // triggers every time a drag ends (DRAG_RESOLUTION -> the full resolution,
  // a big jump in vertex count for a region/implicit curve).
  it('reflects new point data after a curve object grows past its initial buffer size', () => {
    const mgr = new GeometryGroupManager()
    const small: SceneObject = { kind: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }], color: null }
    mgr.update([small], palette, pixelToWorld)
    const objectBefore = mgr.group.children[0]

    const grown: SceneObject = {
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
    const obj: SceneObject = { kind: 'curve', points, color: null }
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
    const obj: SceneObject = { kind: 'curve', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], color: null }
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
    const small: SceneObject = { kind: 'segments', pairs: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]], dashed: true, color: null }
    mgr.update([small], palette, pixelToWorld)

    // Geometrically disjoint from "small" (far away) so any stale leftover
    // vertices from the smaller buffer would clearly fail this check instead
    // of coincidentally passing because the paths overlap.
    const grown: SceneObject = {
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

  it('gives a dashed segment real gaps instead of one solid weighted line', () => {
    const mgr = new GeometryGroupManager()
    // Long enough (5 world units, vs. a 0.12+0.09 dash+gap period) to produce
    // several dash chunks with real gaps between them.
    const obj: SceneObject = { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, dashed: true, color: null }
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
  // A false-positive "asymptote" line (see buildScene.ts's jump-detection —
  // easy to trigger on a steep curve like a parabola at deep zoom-out, where
  // 400 fixed samples spread thin across a wide x-range) spans the full
  // camera bounds height, which at deep zoom-out is thousands of world
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
    const obj: SceneObject = { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 0, y: far }, dashed: true, color: null }

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
    const obj: SceneObject = {
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
