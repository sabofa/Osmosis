import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HoverResolver } from './hover'
import { Camera2D } from './camera2d'
import type { Scene } from '../scene/types'

const HOVER_COLOR = 0xc65d22
const BG_COLOR = 0xffffff
const pixelToWorld = (px: number) => px * 0.01
const CANVAS = 800

function resolveAt(resolver: HoverResolver, scene: Scene, camera: Camera2D, worldX: number, worldY: number) {
  const cursorScreen = camera.worldToScreen(worldX, worldY, CANVAS, CANVAS)
  const cursorWorld = camera.screenToWorld(cursorScreen.x, cursorScreen.y, CANVAS, CANVAS)
  return resolver.resolve(scene, 'all', cursorScreen, cursorWorld, camera, CANVAS, CANVAS, HOVER_COLOR, BG_COLOR, pixelToWorld)
}

describe('HoverResolver', () => {
  it('draws a guide line down to the current bottom of the view', () => {
    const camera = new Camera2D(CANVAS, CANVAS) // default viewHeight=12, centered (0,0) -> bounds -6..6
    const scene: Scene = {
      objects: [{ kind: 'curve', points: [{ x: -5, y: 2 }, { x: 0, y: 2 }, { x: 5, y: 2 }] }],
      errors: [],
      regression: null,
    }
    const resolver = new HoverResolver()
    const info = resolveAt(resolver, scene, camera, 0, 2)
    expect(info).not.toBeNull()

    const line = resolver.group.children[0] as THREE.Line
    const position = line.geometry.getAttribute('position')
    expect(position.getX(0)).toBeCloseTo(0, 5)
    expect(position.getY(0)).toBeCloseTo(-6, 5) // bounds.yMin
    expect(position.getY(1)).toBeCloseTo(2, 5) // the hovered point itself
  })

  // Regression test for a real bug: refreshGuideLine exists specifically so
  // the guide line keeps reaching the true bottom of the view during an
  // active drag/zoom, when the full resolve() scan is deliberately skipped
  // (see SceneRenderer.ts's `dragging` guard) — without it, the line's far
  // vertex stays baked in at whatever bounds.yMin was current the moment it
  // was drawn, and visibly stops short of the newly-visible grid once you've
  // panned or zoomed enough for the real bounds to move past it.
  it('refreshGuideLine extends the line to new bounds without a full re-resolve', () => {
    const camera = new Camera2D(CANVAS, CANVAS)
    const scene: Scene = {
      objects: [{ kind: 'curve', points: [{ x: -5, y: 2 }, { x: 0, y: 2 }, { x: 5, y: 2 }] }],
      errors: [],
      regression: null,
    }
    const resolver = new HoverResolver()
    resolveAt(resolver, scene, camera, 0, 2)

    // Zoom out around the exact screen center — the camera stays centered on
    // (0, 0), so this doubles viewHeight (12 -> 24) with no center shift,
    // giving an exactly predictable new bounds.yMin of -12.
    camera.zoomAt(2, CANVAS / 2, CANVAS / 2, CANVAS, CANVAS)
    resolver.refreshGuideLine(camera)

    const line = resolver.group.children[0] as THREE.Line
    const position = line.geometry.getAttribute('position')
    expect(position.getY(0)).toBeCloseTo(-12, 5) // now reaches the new bottom of the view
    expect(position.getY(1)).toBeCloseTo(2, 5) // the hovered point itself never moved
  })

  it('refreshGuideLine is a no-op when nothing is currently hovered', () => {
    const camera = new Camera2D(CANVAS, CANVAS)
    const resolver = new HoverResolver()
    expect(() => resolver.refreshGuideLine(camera)).not.toThrow()
    expect(resolver.group.children.length).toBe(0)
  })
})
