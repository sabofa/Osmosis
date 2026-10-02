import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { PATH_POINTS, ROLES, type PaintView, type StrokeBatch } from '../types'
import { buildParticles, paintFrame } from './index'
import { flatColours, graphMesh, makeGBuffer, meshGBuffer, paintView, quadMesh, sceneOf } from './testing'

vi.setConfig({ testTimeout: 120_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: [0.6, 0.02, -0.06] })
const GLAZE = ROLES.indexOf('glaze')

// A sheet seen from above or at a graze (opacity 0.4, so a veil), alone in the view: a veil is not in the
// G-buffer, and nothing else is drawn.
const sheet = quadMesh({ origin: [-1, -1, 0], e1: [2, 0, 0], e2: [0, 2, 0], n: 6, opacity: 0.4, index: 0 })
const scene = sceneOf([sheet])
const particles = buildParticles(scene, COLOURS, P)

function veilStrokes(view: PaintView): StrokeBatch {
  const g = makeGBuffer(view, 2, () => null)
  return paintFrame(scene, particles, view, g, P).strokes
}

// How much of each pixel the veil's strokes cover: 1 - exp(-tau), tau the sum, over the strokes that pass over
// the pixel, of -ln(1 - alpha x efficacy). `efficacy` is how much of its alpha a stroke lays where it stands:
// the brush turns a deposit d into min(1, 0.42 + 1.6 d) of the alpha, so a stroke loaded to 0.36 or more at its
// middle lays all of it, and ~0.9 over its body. Counted on a 4 px grid, over the part of the stroke within 0.8 of
// its half-width.
function film(b: StrokeBatch, width: number, height: number, efficacy = 0.9): number[] {
  const S = 4
  const gw = Math.ceil(width / S)
  const gh = Math.ceil(height / S)
  const tau = new Float32Array(gw * gh)
  const stamp = new Int32Array(gw * gh).fill(-1)
  for (let i = 0; i < b.count; i++) {
    if (b.role[i] !== GLAZE) continue
    const a = Math.min(b.alpha[i], 0.34) * efficacy
    const w = -Math.log(1 - Math.min(a, 0.99))
    for (let q = 0; q + 1 < PATH_POINTS; q++) {
      const x0 = b.path[2 * (PATH_POINTS * i + q)]
      const y0 = b.path[2 * (PATH_POINTS * i + q) + 1]
      const x1 = b.path[2 * (PATH_POINTS * i + q + 1)]
      const y1 = b.path[2 * (PATH_POINTS * i + q + 1) + 1]
      const r = (b.width[PATH_POINTS * i + q] / 2) * 0.8
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / S))
      for (let t = 0; t <= steps; t++) {
        const x = x0 + ((x1 - x0) * t) / steps
        const y = y0 + ((y1 - y0) * t) / steps
        for (let yy = Math.max(0, Math.floor((y - r) / S)); yy <= Math.min(gh - 1, Math.floor((y + r) / S)); yy++) {
          for (let xx = Math.max(0, Math.floor((x - r) / S)); xx <= Math.min(gw - 1, Math.floor((x + r) / S)); xx++) {
            const k = yy * gw + xx
            if (stamp[k] === i) continue
            stamp[k] = i
            tau[k] += w
          }
        }
      }
    }
  }
  const out: number[] = []
  for (let k = 0; k < gw * gh; k++) if (tau[k] > 0) out.push(1 - Math.exp(-tau[k]))
  return out.sort((x, y) => x - y)
}

const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length
const at = (xs: number[], p: number) => xs[Math.floor(p * (xs.length - 1))]

describe('a veil reads as a film: tinted and brushy, with the surface behind it showing', () => {
  const W = 800
  const H = 600
  // from above (the sheet face on) and at a graze
  const above = veilStrokes(paintView({ width: W, height: H, azimuth: 30, elevation: 80, zoom: 160 }))
  const graze = veilStrokes(paintView({ width: W, height: H, azimuth: 30, elevation: 8, zoom: 160 }))

  it('covers about 0.6 of the pixels it lies over, face on: not the 0.9 and more that hid the surface behind it', () => {
    const f = film(above, W, H)
    expect(f.length).toBeGreaterThan(2000)
    expect(mean(f)).toBeGreaterThan(0.5)
    expect(mean(f)).toBeLessThan(0.75)
    // brushy: some of it thin, some of it solid, none of it all one coat
    expect(at(f, 0.1)).toBeLessThan(0.45)
    expect(at(f, 0.9)).toBeGreaterThan(0.7)
    expect(at(f, 0.9)).toBeLessThan(0.97)
  })

  it('and still a film at a graze, where the first calibration faded it to a haze', () => {
    const f = film(graze, W, H)
    expect(f.length).toBeGreaterThan(300)
    expect(mean(f)).toBeGreaterThan(0.33)
    expect(mean(f)).toBeLessThan(0.75)
    // the strokes keep their alpha at a graze (8 degrees up: |n.v| = 0.14, where a surface's strokes are three quarters faded
    // out): the mean alpha is over 0.8 of the veil's own 0.3
    let a = 0
    let n = 0
    for (let i = 0; i < graze.count; i++) {
      if (graze.role[i] !== GLAZE) continue
      a += graze.alpha[i]
      n++
    }
    expect(a / n).toBeGreaterThan(0.8 * 0.3)
  })

  it('ends a veil stroke like a dry brush lifting, not a cut: half dissolved, where a core glaze ends crisp', () => {
    const END = (b: StrokeBatch) => {
      let s = 0
      let n = 0
      for (let i = 0; i < b.count; i++) {
        if (b.role[i] !== GLAZE || b.dry[i] > 0.5) continue
        s += b.endSoft[i]
        n++
      }
      return s / n
    }
    expect(END(above)).toBeGreaterThan(0.45)
    expect(END(above)).toBeLessThan(0.75)
  })

  it('loads a veil stroke three times the glaze role’s load, so the brush lays all of its alpha (a deposit past 0.36)', () => {
    let load = 0
    let n = 0
    for (let i = 0; i < above.count; i++) {
      if (above.role[i] !== GLAZE) continue
      load += above.load[i]
      n++
    }
    // the role's 0.3 x 3 = 0.9, within the strokes' own variation (and the dry scumbles of the border, which keep the role's load)
    expect(load / n).toBeGreaterThan(0.7)
    expect(load / n).toBeLessThan(1.0)
  })

  it('puts a veil’s strokes at 0.1 of the glaze role’s screen density', () => {
    // the glaze role asks for 0.7 x 90 = 63 strokes to 10k px²; a veil's are 0.1 of that, 6 (a veil stroke is 40 to 80 px wide and
    // 80 to 160 long, so that is a coat of 3 or so), a little under that where the density fade thins them
    const f = film(above, W, H)
    const covered = f.length * 16
    const strokes = Array.from({ length: above.count }, (_, i) => i).filter((i) => above.role[i] === GLAZE && above.dry[i] < 0.5).length
    const per10k = (strokes / covered) * 10000
    expect(per10k).toBeGreaterThan(2.5)
    expect(per10k).toBeLessThan(8)
  })
})

describe('the surface behind a veil is painted as an opaque form (the tangent plane over its hill)', () => {
  // a hill, and a translucent plane over it (opacity 0.3, lying above the summit and tilted)
  const hill = graphMesh((x, y) => 0.8 * Math.exp(-(x * x + y * y) / 0.6), { half: 1.2, n: 48, index: 0 })
  const plane = quadMesh({ origin: [-1, -1, 0.5], e1: [2, 0, 0.3], e2: [0, 2, 0.2], n: 6, opacity: 0.3, index: 1 })
  const colours = flatColours({ 0: [0.62, 0.04, 0.05], 1: [0.7, 0.03, -0.02] })
  const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 40, zoom: 130 })

  const run = (marks: Parameters<typeof sceneOf>[0]) => {
    const sc = sceneOf(marks)
    // only the opaque hill is in the G-buffer, as the renderer's is
    const g = meshGBuffer(640, 480, [{ mesh: hill, mark: 0 }], { view, params: P })
    return paintFrame(sc, buildParticles(sc, colours, P), view, g, P)
  }
  const bare = run([hill])
  const veiled = run([hill, plane])

  it('paints the hill with the same block-in and form strokes with the veil over it as without', () => {
    expect(bare.stats.byRole.block).toBeGreaterThan(100)
    expect(veiled.stats.byRole.block).toBe(bare.stats.byRole.block)
    expect(veiled.stats.byRole.form).toBe(bare.stats.byRole.form)
    // and the veil adds glazes over it, which are what is new
    expect(veiled.stats.byRole.glaze).toBeGreaterThan(bare.stats.byRole.glaze + 10)
  })

  it('lays the veil over the hill: every glaze of the plane is painted after (over) every block-in stroke', () => {
    const b = veiled.strokes
    const block = ROLES.indexOf('block')
    let lastBlock = -1
    let firstGlaze = b.count
    for (let i = 0; i < b.count; i++) {
      if (b.role[i] === block) lastBlock = Math.max(lastBlock, b.layer[i])
      if (b.role[i] === GLAZE) firstGlaze = Math.min(firstGlaze, b.layer[i])
    }
    expect(firstGlaze).toBeGreaterThan(lastBlock)
    // the hill's block-in is opaque paint (the brush's own opacity), not a veil's 0.3
    let opaque = 0
    for (let i = 0; i < b.count; i++) if (b.role[i] === block && b.alpha[i] > 0.5) opaque++
    expect(opaque).toBeGreaterThan(veiled.stats.byRole.block * 0.5)
  })
})
