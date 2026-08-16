import * as THREE from 'three'
import type { HoverMode } from '../parser/config'
import type { Camera2D } from './camera2d'
import { clearAndDispose } from './disposeObject3D'
import type { Scene as GraphScene, Vec2 } from '../scene/types'

export interface HoverInfo {
  worldX: number
  worldY: number
  screenX: number
  screenY: number
  label?: string
}

const HOVER_MAX_SCREEN_DIST = 70

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
    pixelToWorld: (px: number) => number
  ): HoverInfo | null {
    let best: { point: Vec2; label?: string; showGuide: boolean; dist: number } | null = null
    const consider = (point: Vec2, label: string | undefined, showGuide: boolean) => {
      const screen = camera2d.worldToScreen(point.x, point.y, rectWidth, rectHeight)
      const dist = Math.hypot(screen.x - cursorScreen.x, screen.y - cursorScreen.y)
      if (dist <= HOVER_MAX_SCREEN_DIST && (!best || dist < best.dist)) {
        best = { point, label, showGuide, dist }
      }
    }

    for (const obj of scene.objects) {
      if (obj.kind === 'point') {
        consider(obj.position, obj.label ?? undefined, false)
      } else if (mode === 'all' && obj.kind === 'curve') {
        // True nearest-point-on-segment per sub-segment, not "interpolate y at
        // the cursor's x" — that breaks down on steep/near-vertical stretches
        // (a steep exponential, an asymptote) where a tiny x-range covers a
        // huge y-range, so the interpolated point can be screen-distant from
        // the cursor even when the cursor is sitting right on the curve.
        for (let i = 0; i < obj.points.length - 1; i++) {
          consider(nearestPointOnSegment(obj.points[i], obj.points[i + 1], cursorWorld), undefined, true)
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
    const target = best as { point: Vec2; label?: string; showGuide: boolean; dist: number }
    this.currentTarget = target.point

    if (target.showGuide) {
      const bounds = camera2d.getBounds()
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(target.point.x, bounds.yMin, 0.1),
        new THREE.Vector3(target.point.x, target.point.y, 0.1),
      ])
      this.guideLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: hoverColor }))
      this.group.add(this.guideLine)
    }
    // Background-colored halo behind the dot, matching the point markers'
    // "stroke cut into the paper" treatment (see SceneRenderer.ts's point
    // builder) so the hover indicator reads as the same family of marker.
    const halo = new THREE.Mesh(new THREE.CircleGeometry(pixelToWorld(7), 24), new THREE.MeshBasicMaterial({ color: backgroundColor }))
    halo.position.set(target.point.x, target.point.y, 0.1)
    this.group.add(halo)
    const dot = new THREE.Mesh(new THREE.CircleGeometry(pixelToWorld(6), 24), new THREE.MeshBasicMaterial({ color: hoverColor }))
    dot.position.set(target.point.x, target.point.y, 0.11)
    this.group.add(dot)

    const screen = camera2d.worldToScreen(target.point.x, target.point.y, rectWidth, rectHeight)
    return {
      worldX: target.point.x,
      worldY: target.point.y,
      screenX: screen.x,
      screenY: screen.y,
      label: target.label,
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
    position.setXYZ(0, this.currentTarget.x, bounds.yMin, 0.1)
    position.setXYZ(1, this.currentTarget.x, this.currentTarget.y, 0.1)
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
