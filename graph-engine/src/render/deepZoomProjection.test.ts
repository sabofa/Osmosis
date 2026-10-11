import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Camera2D } from './camera2d'
import { GeometryGroupManager } from './geometryGroup'

const palette = { curve: 0x2f5fd0, segment: 0x1f8f5f, region: 0x2f5fd0, background: 0xfdf6ea, axis: 0x17170f }

// Deep zoom, end to end without WebGL: a parabola written in float64, stored as float32 relative to the origin, then
// projected with the camera's and group's real matrices (modelView = cameraInverse x groupWorld, float64 on the CPU).
// The projected points must land on the right pixels, spread across the window, not collapse onto one column.
describe('deep zoom projection (a 2e-8 window at (1000, 1000))', () => {
  const b = { xMin: 999.99999999, xMax: 1000.00000001, yMin: 999.99999999, yMax: 1000.00000001 }
  const f = (x: number) => 1000 + 1e8 * (x - 1000) ** 2

  it('lands each vertex on its pixel through the real matrices', () => {
    const cam = new Camera2D(800, 800, b)
    const view = cam.getBounds()
    cam.setOrigin((view.xMin + view.xMax) / 2, (view.yMin + view.yMax) / 2)
    const xs = Array.from({ length: 9 }, (_, i) => b.xMin + ((b.xMax - b.xMin) * i) / 8)
    const mgr = new GeometryGroupManager()
    mgr.update([{ kind: 'curve', points: xs.map((x) => ({ x, y: f(x) })), color: null }], palette, () => 1e-12, cam.origin())
    const mesh = mgr.group.children[0] as THREE.Mesh
    const pos = mesh.geometry.getAttribute('position').array
    cam.camera.updateMatrixWorld(true)
    mgr.group.updateMatrixWorld(true)
    mesh.modelViewMatrix.multiplyMatrices(cam.camera.matrixWorldInverse, mesh.matrixWorld)
    xs.forEach((x, i) => {
      const ndc = new THREE.Vector3((pos[i * 6] + pos[i * 6 + 3]) / 2, (pos[i * 6 + 1] + pos[i * 6 + 4]) / 2, 0)
        .applyMatrix4(mesh.modelViewMatrix)
        .applyMatrix4(cam.camera.projectionMatrix)
      const wantX = (2 * (x - view.xMin)) / (view.xMax - view.xMin) - 1
      const wantY = (2 * (f(x) - view.yMin)) / (view.yMax - view.yMin) - 1
      expect(ndc.x).toBeCloseTo(wantX, 3)
      expect(ndc.y).toBeCloseTo(wantY, 3)
    })
  })
})

describe('ribbon weight at deep zoom', () => {
  it('tapers by curvature on a 2e-8 curve as it does on a 2-unit one', () => {
    const widthsOf = (scale: number) => {
      const mgr = new GeometryGroupManager()
      const pts = Array.from({ length: 300 }, (_, i) => {
        const t = -1 + (2 * i) / 299
        return { x: 1000 + t * scale, y: 1000 + t * t * scale }
      })
      mgr.update([{ kind: 'curve', points: pts, color: null }], palette, (px) => px * scale * 1e-3, { x: 1000, y: 1000 })
      const pos = (mgr.group.children[0] as THREE.Mesh).geometry.getAttribute('position').array
      return pts.map((_, i) => Math.hypot(pos[i * 6] - pos[i * 6 + 3], pos[i * 6 + 1] - pos[i * 6 + 4]) / scale)
    }
    const big = widthsOf(2)
    const small = widthsOf(2e-8)
    big.forEach((w, i) => expect(small[i]).toBeCloseTo(w, 2))
  })
})
