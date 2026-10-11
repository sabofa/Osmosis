import * as THREE from 'three'
import type { FeatureKind, HoverMode } from '../parser/config'
import type { Camera2D } from './camera2d'
import { vertexCount } from '../scene/chains'
import { clearAndDispose } from './disposeObject3D'
import type { Scene as GraphScene, Vec2 } from '../scene/types'
import { scaleOf, type Scale } from '../plot/frame/scale'

export interface HoverInfo {
  worldX: number
  worldY: number
  screenX: number
  screenY: number
  label?: string
  // Smaller side of the visible world window when read: the digits a readout needs.
  span: number
  // True when the reported position is a feature's exact location rather than
  // an interpolated point on a sampled curve. The marker is drawn differently
  // so an exact reading is visibly not a guess.
  exact: boolean
  feature?: FeatureKind | null
}

export interface HoverScales {
  x: Scale
  y: Scale
}
const LINEAR_SCALES: HoverScales = { x: scaleOf(undefined), y: scaleOf(undefined) }

// The readout's world values and digit span for a plane point (u, v). On a log axis the plane holds log10
// values: the reported value is inverse(u). The span is the local world extent of the window about the
// point, per axis inverse(u + w/2) - inverse(u - w/2) (w = the plane window's width on that axis), smaller of
// the two; on a linear axis that is exactly the window's width, so linear readouts are unchanged.
export function hoverReadout(
  point: Vec2,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  scales: HoverScales = LINEAR_SCALES
): { worldX: number; worldY: number; span: number } {
  const local = (s: Scale, p: number, lo: number, hi: number) => {
    const w = hi - lo
    return s.kind === 'linear' ? w : Math.abs(s.inverse(p + w / 2) - s.inverse(p - w / 2))
  }
  return {
    worldX: scales.x.inverse(point.x),
    worldY: scales.y.inverse(point.y),
    span: Math.min(local(scales.x, point.x, bounds.xMin, bounds.xMax), local(scales.y, point.y, bounds.yMin, bounds.yMax)),
  }
}

// Hover marker geometry is built relative to the camera's origin (float32 holds only ~7 digits).
const HOVER_MAX_SCREEN_DIST = 70
// How close the cursor must be, in screen pixels, for a feature to capture the
// readout. Deliberately smaller than HOVER_MAX_SCREEN_DIST: snapping should
// feel like magnetism near the feature, not like the readout teleporting.
const SNAP_SCREEN_DIST = 22
// A feature within the snap radius beats a curve point this much nearer, so
// you can land on a vertex that sits directly on the curve you are tracing.
const FEATURE_BIAS_PX = 14

function nearestPointOnSegment(from: Vec2, to: Vec2, p: Vec2): Vec2 {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return from
  let t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / lenSq
  t = Math.min(Math.max(t, 0), 1)
  return { x: from.x + dx * t, y: from.y + dy * t }
}

// Single resolver every @hover mode is built on — one flat candidate list,
// whichever candidate is genuinely nearest the cursor on screen wins, so two
// nearby curves or a point sitting on a curve don't need special-casing.
// Owns its own group of hover-marker meshes (dot + optional guide line),
// rebuilt fresh on every resolve() call since it's cheap relative to the
// candidate scan itself.
export class HoverResolver {
  readonly group = new THREE.Group()
  // Remembered so refreshGuideLine (below) can re-draw just the line without
  // redoing the full candidate scan resolve() does.
  private currentTarget: Vec2 | null = null
  private guideLine: THREE.Line | null = null

  resolve(
    scene: GraphScene,
    mode: HoverMode,
    cursorScreen: Vec2,
    cursorWorld: Vec2,
    camera2d: Camera2D,
    rectWidth: number,
    rectHeight: number,
    hoverColor: number,
    backgroundColor: number,
    pixelToWorld: (px: number) => number,
    // Per-axis world size of a px length; without it the view is taken as isotropic.
    pixelToWorldXY: (px: number) => Vec2 = (px) => ({ x: pixelToWorld(px), y: pixelToWorld(px) }),
    scales: HoverScales = LINEAR_SCALES
  ): HoverInfo | null {
    let best: {
      point: Vec2
      label?: string
      showGuide: boolean
      dist: number
      exact: boolean
      feature?: FeatureKind | null
    } | null = null

    const consider = (
      point: Vec2,
      label: string | undefined,
      showGuide: boolean,
      exact = false,
      feature: FeatureKind | null = null
    ) => {
      const screen = camera2d.worldToScreen(point.x, point.y, rectWidth, rectHeight)
      const raw = Math.hypot(screen.x - cursorScreen.x, screen.y - cursorScreen.y)
      if (raw > HOVER_MAX_SCREEN_DIST) return
      // A feature close enough to snap competes at a discounted distance, so a
      // vertex sitting on the curve wins against the curve sample beside it.
      const dist = feature && raw <= SNAP_SCREEN_DIST ? Math.max(raw - FEATURE_BIAS_PX, 0) : raw
      if (!best || dist < best.dist) {
        best = { point, label, showGuide, dist, exact, feature }
      }
    }

    for (const obj of scene.objects) {
      if (obj.kind === 'point') {
        if (mode === 'features' && !obj.feature) continue
        consider(obj.position, obj.label ?? undefined, false, obj.exact ?? false, obj.feature ?? null)
      } else if (obj.kind === 'mark') {
        // A hole or an endpoint is a point with a typed claim, not a detected
        // feature, so it is read like a plain point: exact when the position is
        // analytic, with no snap bias and no guide line.
        if (mode === 'features') continue
        consider(obj.at, undefined, false, obj.exact)
      } else if (mode === 'all' && obj.kind === 'curve') {
        // True nearest-point-on-segment per sub-segment, not "interpolate y at
        // the cursor's x" — that breaks down on steep/near-vertical stretches
        // (a steep exponential, an asymptote) where a tiny x-range covers a
        // huge y-range, so the interpolated point can be screen-distant from
        // the cursor even when the cursor is sitting right on the curve.
        //
        // Chain by chain: the end of one chain and the start of the next are
        // separated by a break, and nothing is drawn between them, so nothing
        // may be hoverable there. A closed chain's last vertex joins its first.
        for (const chain of obj.chains) {
          const n = vertexCount(chain)
          if (n < 2) continue
          const pairs = chain.closed ? n : n - 1
          for (let i = 0; i < pairs; i++) {
            const j = (i + 1) % n
            const from = { x: chain.xy[2 * i], y: chain.xy[2 * i + 1] }
            const to = { x: chain.xy[2 * j], y: chain.xy[2 * j + 1] }
            consider(nearestPointOnSegment(from, to, cursorWorld), undefined, true)
          }
        }
      } else if (mode === 'all' && (obj.kind === 'segment' || obj.kind === 'ray')) {
        consider(nearestPointOnSegment(obj.from, obj.to, cursorWorld), undefined, true)
      } else if (mode === 'all' && obj.kind === 'segments') {
        for (const [a, b] of obj.pairs) {
          consider(nearestPointOnSegment(a, b, cursorWorld), undefined, true)
        }
      }
    }

    clearAndDispose(this.group)
    this.currentTarget = null
    this.guideLine = null
    if (!best) return null
    const target = best as {
      point: Vec2
      label?: string
      showGuide: boolean
      dist: number
      exact: boolean
      feature?: FeatureKind | null
    }
    this.currentTarget = target.point

    if (target.showGuide) {
      const bounds = camera2d.getBounds()
      const o = camera2d.origin()
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(target.point.x - o.x, bounds.yMin - o.y, 0.1),
        new THREE.Vector3(target.point.x - o.x, target.point.y - o.y, 0.1),
      ])
      this.guideLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: hoverColor }))
      this.guideLine.position.set(o.x, o.y, 0)
      this.group.add(this.guideLine)
    }
    // Background-colored halo behind the dot, matching the point markers'
    // "stroke cut into the paper" treatment (see SceneRenderer.ts's point
    // builder) so the hover indicator reads as the same family of marker.
    // Unit circles scaled per axis, so a round dot stays round on screen when px-per-unit differ in x and y.
    const haloR = pixelToWorldXY(7)
    const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: backgroundColor }))
    halo.scale.set(haloR.x, haloR.y, 1)
    halo.position.set(target.point.x, target.point.y, 0.1)
    this.group.add(halo)
    const dotR = pixelToWorldXY(6)
    const dot = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: hoverColor }))
    dot.scale.set(dotR.x, dotR.y, 1)
    dot.position.set(target.point.x, target.point.y, 0.11)
    this.group.add(dot)

    const screen = camera2d.worldToScreen(target.point.x, target.point.y, rectWidth, rectHeight)
    const readout = hoverReadout(target.point, camera2d.getBounds(), scales)
    return {
      worldX: readout.worldX,
      worldY: readout.worldY,
      screenX: screen.x,
      screenY: screen.y,
      label: target.label,
      span: readout.span,
      exact: target.exact,
      feature: target.feature,
    }
  }

  // A cheap per-frame companion to resolve(), meant for an active drag/pan:
  // resolve() itself is deliberately skipped for the whole drag (see
  // SceneRenderer.ts's `dragging` guard — hit-testing every curve sample on
  // every drag frame just to keep showing the same marker isn't worth it),
  // but the guide line's far end is a plain vertex baked in at whatever
  // bounds.yMin was current the moment it was drawn, so leaving it alone
  // while the camera pans means it stops reaching the true bottom of the
  // view as soon as the real bounds move past it. The dot itself needs no
  // such touch-up — it's positioned at the hovered *world* point, so the
  // camera moving past it during a pan is already handled by the ordinary
  // render loop, same as any other object in the scene.
  refreshGuideLine(camera2d: Camera2D) {
    if (!this.guideLine || !this.currentTarget) return
    const bounds = camera2d.getBounds()
    const position = this.guideLine.geometry.getAttribute('position') as THREE.BufferAttribute
    const o = camera2d.origin()
    this.guideLine.position.set(o.x, o.y, 0)
    position.setXYZ(0, this.currentTarget.x - o.x, bounds.yMin - o.y, 0.1)
    position.setXYZ(1, this.currentTarget.x - o.x, this.currentTarget.y - o.y, 0.1)
    position.needsUpdate = true
    this.guideLine.geometry.computeBoundingSphere()
  }

  clear() {
    clearAndDispose(this.group)
    this.currentTarget = null
    this.guideLine = null
  }

  dispose() {
    clearAndDispose(this.group)
    this.currentTarget = null
    this.guideLine = null
  }
}
