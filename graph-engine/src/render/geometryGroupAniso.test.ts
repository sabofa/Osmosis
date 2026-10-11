import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GeometryGroupManager } from './geometryGroup'
import type { GeometryItem } from './renderItems'

const palette = { curve: 0x2f5fd0, segment: 0x1f8f5f, region: 0x2f5fd0, background: 0xfdf6ea, axis: 0x17170f }
// Unequal axes: x has 2 world units per px, y has 1 (wppx = 2 * wppy).
const WX = 0.02
const WY = 0.01
const pw = (px: number) => px * WX
const pwXY = (px: number) => ({ x: px * WX, y: px * WY })

function build(items: GeometryItem[], aniso: boolean): THREE.Mesh {
  const m = new GeometryGroupManager()
  m.update(items, palette, pw, { x: 0, y: 0 }, aniso ? pwXY : undefined)
  return m.group.children[0] as THREE.Mesh
}
const arr = (m: THREE.Mesh) => m.geometry.getAttribute('position').array as Float32Array

// On-screen px length of a world vector.
const px = (dx: number, dy: number) => Math.hypot(dx / WX, dy / WY)

describe('anisotropic line widths', () => {
  // A straight 2-point segment ribbon: vertices 0 (+n) and 1 (-n) around `from`.
  const thickness = (to: { x: number; y: number }) => {
    const p = arr(build([{ kind: 'segment', from: { x: 0, y: 0 }, to, color: null }], true))
    return px(p[0] - p[3], p[1] - p[4])
  }
  it('horizontal, vertical and 45-degree (on screen) lines are the same px thick', () => {
    const w = 2.5
    expect(thickness({ x: 10, y: 0 })).toBeCloseTo(w, 4)
    expect(thickness({ x: 0, y: 10 })).toBeCloseTo(w, 4)
    expect(thickness({ x: 10 * WX * 5, y: 10 * WY * 5 })).toBeCloseTo(w, 4)
  })

  it('a curve ribbon is the same px thick horizontally and vertically', () => {
    const ribbonPx = (pts: { x: number; y: number }[]) => {
      const p = arr(build([{ kind: 'curve', points: pts, color: null }], true))
      return px(p[0] - p[3], p[1] - p[4])
    }
    const h = ribbonPx([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])
    const v = ribbonPx([{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }])
    expect(v).toBeCloseTo(h, 4)
  })

  it('dashes of 7 px have equal px length horizontally and vertically', () => {
    const dashLens = (to: { x: number; y: number }) => {
      const m = build([{ kind: 'segment', from: { x: 0, y: 0 }, to, dashed: true, color: null }], true)
      const p = arr(m)
      const out: number[] = []
      for (let q = 0; q + 3 < p.length / 3; q += 4) {
        // vertices q (from+n), q+2 (to+n)
        out.push(px(p[(q + 2) * 3] - p[q * 3], p[(q + 2) * 3 + 1] - p[q * 3 + 1]))
      }
      return out
    }
    const h = dashLens({ x: 2, y: 0 })
    const v = dashLens({ x: 0, y: 1 })
    expect(h[0]).toBeCloseTo(7, 3)
    expect(v[0]).toBeCloseTo(7, 3)
    expect(h.length).toBeGreaterThan(3)
  })

  it('isotropic output is identical with or without the XY function', () => {
    const items: GeometryItem[] = [{ kind: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }], color: null }]
    const a = new GeometryGroupManager()
    a.update(items, palette, pw)
    const b = new GeometryGroupManager()
    b.update(items, palette, pw, { x: 0, y: 0 }, (q) => ({ x: pw(q), y: pw(q) }))
    expect(Array.from(arr(b.group.children[0] as THREE.Mesh))).toEqual(Array.from(arr(a.group.children[0] as THREE.Mesh)))
  })
})
