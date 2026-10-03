import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../params'
import type { GBuffer, PaintFrame, PaintView, SceneColours } from '../types'
import type { SpaceScene } from '../../scene/types'
import { labToLch, lchToLab, linearToOklab } from './colour'
import { buildParticles, paintFrame } from './index'
import { isLightFamily } from './value'
import { flatColours, graphMesh, meshGBuffer, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { fillUnderpaint, UNDERPAINT_CELL_PX, UNDERPAINT_MIX, type UnderpaintField } from './underpaint'

vi.setConfig({ testTimeout: 120_000 })

const P = DEFAULT_PAINT_PARAMS

// ---- the image fill, with a field made by hand ----

// 4 x 1 G-buffer pixels, a lattice cell 2 pixels wide: two cells, each with one sample of mark 0, red and blue. Every pixel
// and sample is of the light family unless `ownerFams` and `fams` say otherwise.
const field = (owner: number[], marks: number[] = [0, 0], ownerFams: number[] = [0, 0, 0, 0], fams: number[] = [0, 0]): UnderpaintField => ({
  width: 4,
  height: 1,
  owner: Int32Array.from(owner),
  ownerFam: Uint8Array.from(ownerFams),
  lw: 2,
  lh: 1,
  cell: 2,
  cellStart: Int32Array.from([0, 1, 2]),
  count: 2,
  mark: Int32Array.from(marks),
  fam: Uint8Array.from(fams),
  bound: new Float32Array(2),
  lab: new Float32Array(6),
  u: new Float32Array(2),
  nz: new Float32Array(2),
  bounce: new Float32Array(2),
  amb: new Float32Array(2),
  plane: new Float32Array(6),
  pos: new Float32Array(6),
  flags: new Uint8Array(2),
  cellOf: new Uint32Array(2),
})
const RED_BLUE = Float32Array.from([1, 0, 0, 0, 0, 1])

describe('filling the image from the samples', () => {
  it('is bilinear between the samples of the pixel’s own mark, with the centre of a cell at its sample', () => {
    // pixel x has lattice position (x + 0.5) / 2 - 0.5 = -0.25, 0.25, 0.75, 1.25 (cell centres at 0 and 1): so
    // red alone (the other corner is outside), 3/4 red and 1/4 blue, 1/4 red and 3/4 blue, blue alone
    const image = fillUnderpaint(field([0, 0, 0, 0]), RED_BLUE)
    const expected = [[1, 0, 0], [0.75, 0, 0.25], [0.25, 0, 0.75], [0, 0, 1]]
    expected.forEach((rgb, x) => rgb.forEach((v, c) => expect(image[3 * x + c], `pixel ${x} channel ${c}`).toBeCloseTo(v, 6)))
  })

  it('is NaN where nothing is painted, and takes nothing from a sample of another mark', () => {
    // pixel 1 is no one's (-1); pixel 2 belongs to mark 1, which has no sample anywhere near
    const image = fillUnderpaint(field([0, -1, 1, 0]), RED_BLUE)
    expect([image[3], image[4], image[5]].every(Number.isNaN)).toBe(true)
    expect([image[6], image[7], image[8]].every(Number.isNaN)).toBe(true)
    // pixel 0 and 3 are as before
    expect([image[0], image[1], image[2]]).toEqual([1, 0, 0])
    expect([image[9], image[10], image[11]]).toEqual([0, 0, 1])
  })

  it('never blends across marks: where the second cell’s sample is of another mark, a pixel of the first mark takes the first cell’s alone', () => {
    // cell 1's sample is of mark 1; pixel 1 (mark 0) sits between the cells but sees only red
    const image = fillUnderpaint(field([0, 0, 1, 1], [0, 1]), RED_BLUE)
    expect([image[3], image[4], image[5]]).toEqual([1, 0, 0])
    expect([image[6], image[7], image[8]]).toEqual([0, 0, 1])
  })
})

// ---- the underpainting of frames ----

const sphereScene = (): { scene: SpaceScene; colours: SceneColours } => ({
  scene: sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })]),
  colours: flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85) }),
})

interface Shot {
  g: GBuffer
  frame: PaintFrame
  view: PaintView
}

const sphereShot = (params: PaintParams = P): Shot => {
  const { scene, colours } = sphereScene()
  const view = paintView({ width: 480, height: 360, azimuth: 30, elevation: 25, zoom: 100 })
  const g = sphereGBuffer(480, 360, { view, params, table: { z: -1, mark: 1 } })
  return { g, view, frame: paintFrame(scene, buildParticles(scene, colours, params), view, g, params) }
}

const pixel = (image: Float32Array, i: number): [number, number, number] => [image[3 * i], image[3 * i + 1], image[3 * i + 2]]

describe('the underpainting of a frame', () => {
  const shot = sphereShot()

  it('is an image the size of the G-buffer, three linear colours a pixel', () => {
    expect(shot.frame.underpaint).toBeInstanceOf(Float32Array)
    expect(shot.frame.underpaint).toHaveLength(3 * shot.g.width * shot.g.height)
  })

  it('paints every pixel of a form and bare table in shadow, and nothing of the table in the light', () => {
    const { g, frame } = shot
    const seen = { sphere: 0, shadow: 0, lit: 0 }
    let wrong = 0
    for (let i = 0; i < g.width * g.height; i++) {
      const painted = !Number.isNaN(frame.underpaint[3 * i])
      let want: boolean
      if (g.mark[i] === 0) {
        seen.sphere++
        want = true
      } else if (g.mark[i] === 1 && g.shadow[i] === 1) {
        seen.shadow++
        want = true
      } else {
        seen.lit++
        want = false
      }
      if (painted !== want) wrong++
    }
    // every kind of pixel is there to be tested
    for (const [kind, n] of Object.entries(seen)) expect(n, kind).toBeGreaterThan(500)
    expect(wrong).toBe(0)
  })

  it('is NaN exactly where the G-buffer is empty, and the image’s edge is the form’s own', () => {
    const { scene, colours } = sphereScene()
    const view = paintView({ width: 480, height: 360, azimuth: 30, elevation: 25, zoom: 100 })
    const g = sphereGBuffer(480, 360, { view, params: P })
    const { underpaint } = paintFrame(scene, buildParticles(scene, colours, P), view, g, P)
    let empty = 0
    let full = 0
    let wrong = 0
    for (let i = 0; i < g.width * g.height; i++) {
      const nan = [0, 1, 2].every((c) => Number.isNaN(underpaint[3 * i + c]))
      const finite = [0, 1, 2].every((c) => Number.isFinite(underpaint[3 * i + c]))
      if (g.mark[i] < 0) {
        empty++
        if (!nan) wrong++
      } else {
        full++
        if (!finite) wrong++
      }
    }
    expect(empty).toBeGreaterThan(500)
    expect(full).toBeGreaterThan(500)
    expect(wrong).toBe(0)
  })

  it('has the colour of each pixel through the lighting curve: lighter in the light than in the core shadow, in the local colour’s family', () => {
    const { g, frame } = shot
    const zones = frame.debug.zones
    const sums = { light: [0, 0, 0], core: [0, 0, 0] }
    const counts = { light: 0, core: 0 }
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] !== 0 || zones[i] === 255) continue
      // ZONES order: light, half, core, reflected, cast
      const key = zones[i] === 0 ? 'light' : zones[i] === 2 ? 'core' : null
      if (!key) continue
      const lab = linearToOklab(...pixel(frame.underpaint, i))
      for (let c = 0; c < 3; c++) sums[key][c] += lab[c]
      counts[key]++
    }
    expect(counts.light).toBeGreaterThan(200)
    expect(counts.core).toBeGreaterThan(200)
    const light = sums.light.map((v) => v / counts.light)
    const core = sums.core.map((v) => v / counts.core)
    // L = local L + 0.8 (u - 0.62): a light of u about 0.9 against a core of 0.24 is half a unit of lightness apart (less the soft limits)
    expect(light[0] - core[0]).toBeGreaterThan(0.35)
    // the local colour is a warm terracotta (L 0.56, C 0.14, h 38) and the light end of it stays warm: yellow-red, positive a and b
    expect(light[1]).toBeGreaterThan(0.02)
    expect(light[2]).toBeGreaterThan(0.02)
    expect(labToLch(light)[1]).toBeGreaterThan(0.05)
  })

  it('is made at a fraction of the strokes’ brush-load mix, and the mix is there', () => {
    expect(UNDERPAINT_MIX).toBe(0.5)
    const flat = sphereShot(setParam(P, 'mix.strength', 0))
    const mixed = shot
    // a block stroke's mix turns the hue by up to mix.hueMax = 25 degrees (and at least hueMin = 12, less the drift to 45%);
    // at half the strength the underpainting turns it by up to 12.5. Only pixels with chroma to spare are turned (a grey takes an a/b vector instead)
    let compared = 0
    let turned = 0
    let most = 0
    for (let i = 0; i < mixed.g.width * mixed.g.height; i++) {
      if (mixed.g.mark[i] !== 0) continue
      const a = labToLch(linearToOklab(...pixel(flat.frame.underpaint, i)))
      const b = labToLch(linearToOklab(...pixel(mixed.frame.underpaint, i)))
      if (a[1] < 0.08) continue
      let d = Math.abs(a[2] - b[2])
      if (d > 180) d = 360 - d
      compared++
      most = Math.max(most, d)
      if (d > 2) turned++
    }
    expect(compared).toBeGreaterThan(1000)
    expect(most).toBeLessThanOrEqual(0.5 * 25 + 1)
    expect(turned).toBeGreaterThan(compared / 4)
  })

  it('is the same image whatever the strokes are, for it is made from the pixels and not from them', () => {
    const other = sphereShot(setParam(setParam(P, 'roles.block.width', 40), 'particles.zoomGrowMax', 1.5))
    expect(Array.from(other.frame.underpaint)).toEqual(Array.from(shot.frame.underpaint))
  })

  it('is deterministic: the same frame twice is the same image, NaN for NaN', () => {
    const again = sphereShot()
    expect(again.frame.underpaint.length).toBe(shot.frame.underpaint.length)
    let different = 0
    for (let i = 0; i < shot.frame.underpaint.length; i++) if (!Object.is(again.frame.underpaint[i], shot.frame.underpaint[i])) different++
    expect(different).toBe(0)
  })

  it('is smooth: made on a lattice of UNDERPAINT_CELL_PX px and filled bilinearly, so a neighbour is never far in colour inside a cell of the mix', () => {
    expect(UNDERPAINT_CELL_PX).toBe(12)
    // along a row through the middle of the sphere, the largest step between neighbouring pixels (2 px) is small in linear sRGB.
    // (The terminator is the one edge the fill keeps: the two value families are not blended, so a step across it is the
    // form's own, and the next test holds it.)
    const { g, frame, view } = shot
    const L = view.lightDir
    const familyAt = (i: number) => isLightFamily(P, g.normal[3 * i] * L[0] + g.normal[3 * i + 1] * L[1] + g.normal[3 * i + 2] * L[2], g.shadow[i] === 1)
    const y = Math.floor(g.height * 0.45)
    let steps = 0
    let largest = 0
    for (let x = 1; x < g.width; x++) {
      const a = y * g.width + x - 1
      const b = a + 1
      if (g.mark[a] !== 0 || g.mark[b] !== 0 || g.depth[a] > 1e9) continue
      if (familyAt(a) !== familyAt(b)) continue
      steps++
      largest = Math.max(largest, ...pixel(frame.underpaint, a).map((v, c) => Math.abs(v - frame.underpaint[3 * b + c])))
    }
    expect(steps).toBeGreaterThan(50)
    // across a plane edge or a mix cell the colour does step, but never by a whole unit of linear light between 2 px neighbours
    expect(largest).toBeLessThan(0.2)
  })
})

describe('the underpainting of a colour-mapped surface', () => {
  const saddle = graphMesh((x, y) => 0.5 * (x * x - y * y), { half: 1, n: 24, scaled: true, index: 0 })
  const flatSaddle = graphMesh((x, y) => 0.5 * (x * x - y * y), { half: 1, n: 24, index: 0 })
  const view = paintView({ width: 480, height: 360, azimuth: 40, elevation: 30, zoom: 130 })
  const spread = (mesh: typeof saddle, colours: SceneColours): number => {
    const scene = sceneOf([mesh])
    const g = meshGBuffer(480, 360, [{ mesh, mark: 0 }], { view })
    const frame = paintFrame(scene, buildParticles(scene, colours, P), view, g, P)
    // the spread of hue over the pixels the surface faces the light with: the mean resultant length of the hues, turned into degrees
    let sx = 0
    let sy = 0
    let n = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] !== 0 || frame.debug.zones[i] !== 0) continue
      const lch = labToLch(linearToOklab(...pixel(frame.underpaint, i)))
      sx += Math.cos((lch[2] * Math.PI) / 180)
      sy += Math.sin((lch[2] * Math.PI) / 180)
      n++
    }
    expect(n).toBeGreaterThan(300)
    return (Math.acos(Math.min(1, Math.hypot(sx, sy) / n)) * 180) / Math.PI
  }

  it('follows the colormap: its hue varies over the surface where a flat colour’s barely does', () => {
    // the colormap: hue 250 - 120 v at every height of the saddle (v from -0.5 to 0.5); the flat colour is one of them
    const mapped = flatColours({ 0: lchToLab(0.6, 0.1, 150) }, (v) => lchToLab(0.45 + 0.4 * v, 0.12, 250 - 120 * v))
    const flat = flatColours({ 0: lchToLab(0.6, 0.1, 150) })
    const mappedSpread = spread(saddle, mapped)
    const flatSpread = spread(flatSaddle, flat)
    expect(mappedSpread).toBeGreaterThan(25)
    expect(flatSpread).toBeLessThan(12)
  })
})
