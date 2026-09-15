import * as THREE from 'three'
import { themedColor, type Palette } from './palette'
import { clearAndDispose, disposeObject3D } from './disposeObject3D'
import type { SceneObject, Vec2 } from '../scene/types'

// Grows (never shrinks) a geometry attribute's buffer in place instead of
// allocating a fresh Float32Array/BufferGeometry every call. This matters far
// more than it looks like it should: recreating a BufferGeometry forces
// three.js to delete the old GPU buffer and allocate+upload a new one, and
// that GPU-side alloc/free is the actual bottleneck during a drag — far more
// than the JS-side math generating the data, and not something that scales
// down just by lowering resolution/vertex count (it's a fixed per-buffer
// cost). Updating an existing buffer's contents (bufferSubData under the
// hood) avoids it entirely.
//
// Hands back the raw Float32Array to write into directly instead of taking a
// plain number[] — building a plain JS array via repeated .push() first (the
// region fill can be 20,000+ numbers) turned out to cost more than the GPU
// upload it was meant to avoid. Direct indexed writes into the typed array
// skip that intermediate allocation entirely.
function growAttribute(geometry: THREE.BufferGeometry, name: string, vertexCount: number, itemSize: number): Float32Array {
  const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined
  if (attr && attr.array.length >= vertexCount * itemSize) {
    attr.needsUpdate = true
    return attr.array as Float32Array
  }
  // Plain BufferAttribute, not Float32BufferAttribute — the latter's
  // constructor always copies its input into a fresh Float32Array rather
  // than wrapping it by reference, which would silently disconnect this
  // array from the one actually attached to the geometry the moment the
  // caller writes into it below.
  const array = new Float32Array(vertexCount * itemSize)
  const newAttr = new THREE.BufferAttribute(array, itemSize)
  geometry.setAttribute(name, newAttr)
  return array
}

function finishPositionUpdate(geometry: THREE.BufferGeometry, vertexCount: number) {
  geometry.setDrawRange(0, vertexCount)
  geometry.computeBoundingSphere()
}

// Same idea as finishPositionUpdate, but for an *indexed* geometry (every
// ribbon built here is indexed) — BufferGeometry.setDrawRange's count means
// "how many indices", not "how many vertices", once an index buffer is
// attached. Passing the vertex count there silently truncates rendering to
// whatever prefix of the index buffer that vertex count happens to cover.
function finishIndexedUpdate(geometry: THREE.BufferGeometry, indexCount: number) {
  geometry.setDrawRange(0, indexCount)
  geometry.computeBoundingSphere()
}

// Curve ribbon tuning — matches the "Ink-Framed Ruled Grid" reference's
// defaults (lineWeightIntensity 0.85, baseLineWidth 3, weightStyle
// "curvature"). Not exposed as a DSL/config knob, same as e.g. buildScene's
// SAMPLES constant.
const CURVE_WEIGHT_INTENSITY = 0.85
const CURVE_BASE_WIDTH_PX = 3

// Constant visual weight for straight lines (segments/region boundaries) —
// same "fixed on-screen size" pixelToWorld convention as the curve ribbon
// and point markers, just without a curvature-driven taper (a straight run
// doesn't have a meaningful curvature to vary against).
const LINE_WIDTH_PX = 2.5

// Fixed on-screen dash/gap size — same pixelToWorld convention as
// LINE_WIDTH_PX above, and for the same reason a fixed *world*-unit size
// would be wrong: this used to be DASH_SIZE_WORLD/GAP_SIZE_WORLD (0.12/0.09
// world units, unscaled), which meant a dashed line's chunk COUNT scaled
// with its length in world units — for a line spanning the visible bounds
// at deep zoom-out (thousands of world units tall), that's tens of
// thousands of tiny quads for a single dashed line, all rebuilt on every
// pan/zoom frame. This was the actual cause of a real, measured 150-330ms-
// per-frame freeze when zoomed out far on a steep curve (a false-positive
// asymptote line — see buildScene.ts's jump-detection — spanning the full
// view height). Pixel-fixed dash/gap size bounds chunk count by screen
// resolution instead of world-unit length, the same way every other
// "constant visual size" thing in this file already does.
const DASH_SIZE_PX = 7
const GAP_SIZE_PX = 5

// Per-point "how sharply is the curve turning here" estimate: the angle
// between the incoming and outgoing direction, sampled a few points back/
// ahead (not just adjacent samples) so it isn't swamped by near-collinear
// jitter between neighboring points, divided by the arc length spanned by
// that same window — true curvature is angle change *per unit length*
// (dθ/ds), not angle change alone. Skipping that division was a real bug:
// buildScene always samples a curve at a fixed *count* (400 points) across
// whatever x-range is currently visible, so zooming out spreads those same
// 400 points over more world space. For a curve whose slope varies (e.g. a
// parabola away from its vertex), that coarser spacing alone produces a
// bigger raw angle between stride-separated points — indistinguishable from
// genuine sharp turning if you don't normalize by how far apart those points
// actually are — so the ribbon kept getting wider as you zoomed out, on
// stretches that aren't actually curving any more sharply than before.
// Dividing by arc length makes this a property of the curve's actual shape
// again, independent of sampling density or zoom.
//
// Normalized against the curve's own max so the taper is always visible
// regardless of how gently or sharply the whole curve bends. Width is
// computed in screen pixels then converted to world units via pixelToWorld —
// same "fixed on-screen size" convention as point markers/hover dots — so
// the ribbon's apparent weight stays constant across zoom instead of
// thinning out as you zoom in.
function computeCurveWidths(points: Vec2[], pixelToWorld: (px: number) => number): number[] {
  const n = points.length
  const stride = Math.max(4, Math.round(n / 40))
  const raw: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - stride)]
    const p = points[i]
    const c = points[Math.min(n - 1, i + stride)]
    const distAP = Math.hypot(p.x - a.x, p.y - a.y)
    const distPC = Math.hypot(c.x - p.x, c.y - p.y)
    // A short point array (e.g. a 2-point straight regression line) clamps
    // both neighbor indices back onto i itself, making a or c coincide with
    // p — atan2(0, 0) on that zero-length leg used to read as a sharp turn
    // instead of "no direction here," so a perfectly straight line reported
    // near-maximum curvature at both of its own endpoints and rendered far
    // thicker than every other curve. Treating a degenerate leg as
    // contributing no turn (rather than a defined-but-meaningless angle)
    // fixes that without changing the curvature estimate for any curve long
    // enough for both neighbors to be real, distinct points.
    let d = 0
    if (distAP > 1e-9 && distPC > 1e-9) {
      const ang1 = Math.atan2(p.y - a.y, p.x - a.x)
      const ang2 = Math.atan2(c.y - p.y, c.x - p.x)
      d = Math.abs(ang2 - ang1)
      if (d > Math.PI) d = 2 * Math.PI - d
    }
    const arcLen = distAP + distPC
    raw[i] = arcLen > 1e-9 ? d / arcLen : 0
  }
  let maxRaw = 1e-6
  for (const d of raw) if (d > maxRaw) maxRaw = d

  const widths: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = Math.pow(raw[i] / maxRaw, 0.6)
    const widthPx = CURVE_BASE_WIDTH_PX * 0.5 * (1 - CURVE_WEIGHT_INTENSITY) + CURVE_WEIGHT_INTENSITY * (CURVE_BASE_WIDTH_PX * 3.2) * t + 1
    widths[i] = pixelToWorld(widthPx)
  }
  return widths
}

// Fills `pos` (>= n*2*3 long) with the ribbon's left/right offset vertices —
// each sample point pushed outward along its local normal by half the
// computed width. `pos` is a live view into the geometry's position buffer
// (see growAttribute above), so this writes directly into it.
function fillRibbonPositions(pos: Float32Array, points: Vec2[], widths: number[]): void {
  const n = points.length
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const a = points[Math.max(0, i - 1)]
    const c = points[Math.min(n - 1, i + 1)]
    let dx = c.x - a.x
    let dy = c.y - a.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const nx = -dy
    const ny = dx
    const hw = widths[i] / 2
    const li = i * 2
    const ri = i * 2 + 1
    pos[li * 3] = p.x + nx * hw
    pos[li * 3 + 1] = p.y + ny * hw
    pos[li * 3 + 2] = 0
    pos[ri * 3] = p.x - nx * hw
    pos[ri * 3 + 1] = p.y - ny * hw
    pos[ri * 3 + 2] = 0
  }
}

// Two triangles per segment between consecutive sample points' left/right
// vertex pairs. Point count for a given curve stays fixed run to run unless
// the statement itself changes (a differently-sized asymptote split, an
// edited spec) — the caller only rebuilds this when that count actually
// changes, so a plain pan/zoom drag reuses the same index buffer.
function buildRibbonIndices(n: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    indices.push(l0, r0, l1, r0, r1, l1)
  }
  return indices
}

// Splits a straight [from, to] run into its "on" dash sub-segments,
// skipping the gaps — the geometric equivalent of what LineDashedMaterial
// used to do in the fragment shader, needed now because a filled ribbon
// quad can't be dashed by a line-only shader technique.
// period/dashLen are already in world units (the caller converts once via
// pixelToWorld, not per-iteration) — see the constants' own comment for why
// this must never be a fixed world-unit size. maxChunks is a hard backstop
// independent of that: past a couple thousand dashes nothing on a real
// screen could render them as visually distinct anyway, so it's a cheap
// guarantee against this ever blowing up again regardless of cause.
const MAX_DASH_CHUNKS = 2000

function splitIntoDashChunks(from: Vec2, to: Vec2, period: number, dashLen: number): [Vec2, Vec2][] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0 || period <= 0) return []
  const ux = dx / len
  const uy = dy / len
  const chunks: [Vec2, Vec2][] = []
  for (let d = 0; d < len && chunks.length < MAX_DASH_CHUNKS; d += period) {
    const dashEnd = Math.min(d + dashLen, len)
    chunks.push([
      { x: from.x + ux * d, y: from.y + uy * d },
      { x: from.x + ux * dashEnd, y: from.y + uy * dashEnd },
    ])
  }
  return chunks
}

// Writes one quad (4 vertices, constant half-width) for a straight [from,
// to] run at vertex index `vertIndex` into `pos`.
function fillStraightQuad(pos: Float32Array, vertIndex: number, from: Vec2, to: Vec2, halfWidth: number): void {
  let dx = to.x - from.x
  let dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const nx = -dy * halfWidth
  const ny = dx * halfWidth
  const o = vertIndex * 3
  pos[o] = from.x + nx
  pos[o + 1] = from.y + ny
  pos[o + 2] = 0
  pos[o + 3] = from.x - nx
  pos[o + 4] = from.y - ny
  pos[o + 5] = 0
  pos[o + 6] = to.x + nx
  pos[o + 7] = to.y + ny
  pos[o + 8] = 0
  pos[o + 9] = to.x - nx
  pos[o + 10] = to.y - ny
  pos[o + 11] = 0
}

// Two triangles per quad — same winding convention as buildRibbonIndices.
function buildQuadIndices(quadCount: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < quadCount; i++) {
    const v0 = i * 4
    const v1 = i * 4 + 1
    const v2 = i * 4 + 2
    const v3 = i * 4 + 3
    indices.push(v0, v1, v2, v1, v3, v2)
  }
  return indices
}

export type GeometryKind = 'curve' | 'segment' | 'segments' | 'region'

interface GeometryEntry {
  kind: GeometryKind
  dashed: boolean
  object3d: THREE.Line | THREE.LineSegments | THREE.Mesh
}

export function isGeometryKind(kind: SceneObject['kind']): kind is GeometryKind {
  return kind === 'curve' || kind === 'segment' || kind === 'segments' || kind === 'region'
}

export type GeometryPalette = Pick<Palette, 'curve' | 'segment' | 'region' | 'background' | 'axis'>

type GeometrySceneObject = Extract<SceneObject, { kind: GeometryKind }>

// Owns the curve/segment/segments/region scene objects — the ones with real
// vertex counts that rebuild every frame during a drag. Matched by position
// across rebuilds and updated in place (buffer reused), rather than disposed
// and rebuilt every time the way point/ray/animatedPoint are in
// SceneRenderer's miscGroup: this split is the fix for a real, measured lag
// bug (disposing/recreating GPU buffers every drag frame was the actual
// bottleneck, not the math) — see growAttribute's comment above.
//
// Every kind here renders as a filled ribbon mesh rather than a raw WebGL
// line — 'curve' with a curvature-driven taper (see computeCurveWidths, an
// "artist line weight" effect), everything else at LINE_WIDTH_PX's constant
// weight. This isn't just cosmetic: THREE.LineBasicMaterial's `linewidth`
// is not honored by most browsers/platforms (a long-standing WebGL/ANGLE
// limitation — every plain THREE.Line renders at 1px regardless of what
// you ask for), so without this, segments/region boundaries would always
// read as near-invisible hairlines next to a deliberately-weighted curve.
export class GeometryGroupManager {
  readonly group = new THREE.Group()
  private entries: GeometryEntry[] = []

  // Index-matches the new geometry-kind objects against what's already built
  // (buildScene emits them in a stable, statement-derived order, so during a
  // pure pan/zoom — same statements, same order, just re-sampled — the kind
  // at each index stays the same run to run). Where the kind (and dashed-ness,
  // since that determines how many dash-chunk quads there are) still
  // matches, the existing buffer is updated in place; only a genuine
  // structural change (spec edited, curve split by a newly-detected
  // asymptote, etc.) falls back to disposing and building fresh.
  update(objects: GeometrySceneObject[], palette: GeometryPalette, pixelToWorld: (px: number) => number) {
    const next: GeometryEntry[] = []
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      const dashed = (obj.kind === 'segment' || obj.kind === 'segments') && !!obj.dashed
      const prev = this.entries[i]
      if (prev && prev.kind === obj.kind && prev.dashed === dashed) {
        this.updateObject(prev.object3d, obj, palette, pixelToWorld)
        next.push(prev)
        continue
      }
      if (prev) {
        this.group.remove(prev.object3d)
        disposeObject3D(prev.object3d)
      }
      const built = this.buildObject(obj, palette, pixelToWorld)
      if (built) {
        this.group.add(built)
        next.push({ kind: obj.kind, dashed, object3d: built as THREE.Line | THREE.LineSegments | THREE.Mesh })
      }
    }
    for (let i = objects.length; i < this.entries.length; i++) {
      this.group.remove(this.entries[i].object3d)
      disposeObject3D(this.entries[i].object3d)
    }
    this.entries = next
  }

  private updateObject(object3d: THREE.Line | THREE.LineSegments | THREE.Mesh, obj: GeometrySceneObject, palette: GeometryPalette, pixelToWorld: (px: number) => number) {
    const material = object3d.material as THREE.Material & { color?: THREE.Color }
    const geometry = object3d.geometry

    if (obj.kind === 'curve') {
      const n = obj.points.length
      const widths = computeCurveWidths(obj.points, pixelToWorld)
      const pos = growAttribute(geometry, 'position', n * 2, 3)
      fillRibbonPositions(pos, obj.points, widths)
      // Only rebuild the index buffer when the point count actually changed
      // (an asymptote split, not a plain resample) — same buffer-reuse idea
      // as growAttribute, applied to topology instead of positions.
      const expectedIndexCount = Math.max(0, n - 1) * 6
      if (geometry.index?.count !== expectedIndexCount) {
        geometry.setIndex(buildRibbonIndices(n))
      }
      finishIndexedUpdate(geometry, expectedIndexCount)
      material.color?.setHex(themedColor(obj.color, palette.curve, palette))
    } else if (obj.kind === 'segment') {
      const halfWidth = pixelToWorld(LINE_WIDTH_PX) / 2
      const dashLen = pixelToWorld(DASH_SIZE_PX)
      const chunks: [Vec2, Vec2][] = obj.dashed
        ? splitIntoDashChunks(obj.from, obj.to, dashLen + pixelToWorld(GAP_SIZE_PX), dashLen)
        : [[obj.from, obj.to]]
      const pos = growAttribute(geometry, 'position', chunks.length * 4, 3)
      chunks.forEach(([from, to], i) => fillStraightQuad(pos, i * 4, from, to, halfWidth))
      const expectedIndexCount = chunks.length * 6
      if (geometry.index?.count !== expectedIndexCount) {
        geometry.setIndex(buildQuadIndices(chunks.length))
      }
      finishIndexedUpdate(geometry, expectedIndexCount)
      material.color?.setHex(themedColor(obj.color, palette.segment, palette))
    } else if (obj.kind === 'segments') {
      const halfWidth = pixelToWorld(LINE_WIDTH_PX) / 2
      const dashLen = pixelToWorld(DASH_SIZE_PX)
      const dashPeriod = dashLen + pixelToWorld(GAP_SIZE_PX)
      const allChunks: [Vec2, Vec2][] = obj.dashed
        ? obj.pairs.flatMap(([from, to]) => splitIntoDashChunks(from, to, dashPeriod, dashLen))
        : obj.pairs
      const pos = growAttribute(geometry, 'position', allChunks.length * 4, 3)
      allChunks.forEach(([from, to], i) => fillStraightQuad(pos, i * 4, from, to, halfWidth))
      const expectedIndexCount = allChunks.length * 6
      if (geometry.index?.count !== expectedIndexCount) {
        geometry.setIndex(buildQuadIndices(allChunks.length))
      }
      finishIndexedUpdate(geometry, expectedIndexCount)
      material.color?.setHex(themedColor(obj.color, palette.segment, palette))
    } else if (obj.kind === 'region') {
      const n = obj.triangles.length
      const pos = growAttribute(geometry, 'position', n, 3)
      for (let i = 0; i < n; i++) {
        const p = obj.triangles[i]
        pos[i * 3] = p.x
        pos[i * 3 + 1] = p.y
        pos[i * 3 + 2] = -0.05
      }
      finishPositionUpdate(geometry, n)
      material.color?.setHex(themedColor(obj.color, palette.region, palette))
    }
  }

  private buildObject(obj: GeometrySceneObject, palette: GeometryPalette, pixelToWorld: (px: number) => number): THREE.Object3D | null {
    if (obj.kind === 'curve') {
      const n = obj.points.length
      if (n < 2) return null
      const widths = computeCurveWidths(obj.points, pixelToWorld)
      const positions = new Float32Array(n * 2 * 3)
      fillRibbonPositions(positions, obj.points, widths)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setIndex(buildRibbonIndices(n))
      finishIndexedUpdate(geometry, (n - 1) * 6)
      const color = themedColor(obj.color, palette.curve, palette)
      // DoubleSide: the ribbon's winding stays consistently front-facing for
      // a smoothly-varying curve (verified by construction — see
      // fillRibbonPositions' normal convention), but this costs nothing
      // worth avoiding and removes any doubt for a curve with an unusual
      // local direction reversal.
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    }

    if (obj.kind === 'segment') {
      const halfWidth = pixelToWorld(LINE_WIDTH_PX) / 2
      const dashLen = pixelToWorld(DASH_SIZE_PX)
      const chunks: [Vec2, Vec2][] = obj.dashed
        ? splitIntoDashChunks(obj.from, obj.to, dashLen + pixelToWorld(GAP_SIZE_PX), dashLen)
        : [[obj.from, obj.to]]
      if (chunks.length === 0) return null
      const positions = new Float32Array(chunks.length * 4 * 3)
      chunks.forEach(([from, to], i) => fillStraightQuad(positions, i * 4, from, to, halfWidth))
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setIndex(buildQuadIndices(chunks.length))
      finishIndexedUpdate(geometry, chunks.length * 6)
      const color = themedColor(obj.color, palette.segment, palette)
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    }

    if (obj.kind === 'segments') {
      const halfWidth = pixelToWorld(LINE_WIDTH_PX) / 2
      const dashLen = pixelToWorld(DASH_SIZE_PX)
      const dashPeriod = dashLen + pixelToWorld(GAP_SIZE_PX)
      const allChunks: [Vec2, Vec2][] = obj.dashed
        ? obj.pairs.flatMap(([from, to]) => splitIntoDashChunks(from, to, dashPeriod, dashLen))
        : obj.pairs
      if (allChunks.length === 0) return null
      const positions = new Float32Array(allChunks.length * 4 * 3)
      allChunks.forEach(([from, to], i) => fillStraightQuad(positions, i * 4, from, to, halfWidth))
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setIndex(buildQuadIndices(allChunks.length))
      finishIndexedUpdate(geometry, allChunks.length * 6)
      const color = themedColor(obj.color, palette.segment, palette)
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    }

    if (obj.kind === 'region') {
      if (obj.triangles.length < 3) return null
      const positions = new Float32Array(obj.triangles.length * 3)
      obj.triangles.forEach((p, i) => {
        positions[i * 3] = p.x
        positions[i * 3 + 1] = p.y
        positions[i * 3 + 2] = -0.05
      })
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const color = themedColor(obj.color, palette.region, palette)
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }))
    }

    return null
  }

  dispose() {
    clearAndDispose(this.group)
  }
}
