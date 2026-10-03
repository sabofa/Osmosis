import { describe, expect, it } from 'vitest'
import { HIDDEN_DASHED, HIDDEN_NA, HIDDEN_NONE } from '../bake/types'
import { LAYER_ORDER, PATH_POINTS, ROLES, type StrokeBatch } from '../types'
import { firstOfPlan, packStrokes, planStrokes, ROLE_A, ROLE_B, srgbEncode, srgbEncodeFast, strokeLayout } from './strokes'
import { TEXELS_PER_STROKE } from './shaders/stroke'

// A batch of `n` strokes with the given layers and depths; everything else plain.
function batch(layers: number[], depths: number[]): StrokeBatch {
  const n = layers.length
  const b: StrokeBatch = {
    count: n,
    role: new Uint8Array(n),
    layer: Uint8Array.from(layers),
    path: new Float32Array(n * 2 * PATH_POINTS),
    width: new Float32Array(n * PATH_POINTS).fill(10),
    depth: Float32Array.from(depths),
    colour: new Float32Array(n * 3),
    alpha: new Float32Array(n).fill(1),
    load: new Float32Array(n).fill(1),
    impasto: new Float32Array(n).fill(1),
    bristles: new Float32Array(n).fill(8),
    bristleVar: new Float32Array(n).fill(0.3),
    dry: new Float32Array(n),
    wet: new Float32Array(n),
    endSoft: new Float32Array(n),
    edge: new Uint8Array(n).fill(255),
    seed: new Uint32Array(n),
    worldPath: new Float32Array(n * 3 * PATH_POINTS),
    worldNormal: new Float32Array(n * 3),
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < PATH_POINTS; k++) b.path[i * 2 * PATH_POINTS + 2 * k] = k * 10
  return b
}

describe('planStrokes: layers in LAYER_ORDER, back to front within a layer', () => {
  it('orders five strokes by hand: layer 0 {depth 5, depth 1} then layer 1 {7, 3} then layer 2 {2}', () => {
    // batch index:  0        1        2        3        4
    // layer:        1        0        1        0        2
    // depth:        3        5        7        1        2
    // Layer 0 farthest first: stroke 1 (5) then 3 (1); layer 1: stroke 2 (7) then 0 (3); layer 2: 4.
    const plan = planStrokes(batch([1, 0, 1, 0, 2], [3, 5, 7, 1, 2]))
    expect(Array.from(plan.order)).toEqual([1, 3, 2, 0, 4])
    expect(plan.count).toBe(5)
    expect(Array.from(plan.layerStart)).toEqual([0, 2, 4, 5, 5, 5, 5, 5, 5])
  })

  it('breaks a depth tie by batch index, ascending', () => {
    const plan = planStrokes(batch([0, 0, 0], [2, 2, 2]))
    expect(Array.from(plan.order)).toEqual([0, 1, 2])
  })

  it('draws a stroke with a non-finite depth last in its layer, over everything', () => {
    const plan = planStrokes(batch([0, 0, 0], [Number.NaN, 4, 9]))
    expect(Array.from(plan.order)).toEqual([2, 1, 0])
  })

  it('drops a stroke whose layer is not in LAYER_ORDER, and keeps the rest', () => {
    const plan = planStrokes(batch([0, 200, 1], [1, 2, 3]))
    expect(plan.count).toBe(2)
    expect(Array.from(plan.order)).toEqual([0, 2])
  })

  it('is deterministic: the same batch gives the same order', () => {
    const depths = Array.from({ length: 300 }, (_, i) => ((i * 7919) % 101) / 10)
    const layers = Array.from({ length: 300 }, (_, i) => i % LAYER_ORDER.length)
    const a = planStrokes(batch(layers, depths))
    const b = planStrokes(batch(layers, depths))
    expect(Array.from(a.order)).toEqual(Array.from(b.order))
  })

  it('an empty batch plans nothing', () => {
    const plan = planStrokes(batch([], []))
    expect(plan.count).toBe(0)
    expect(plan.layerStart.every((v) => v === 0)).toBe(true)
  })
})

describe('strokeLayout', () => {
  it('puts 8 strokes to a row by default: 20 strokes -> 160 texels wide, 3 rows', () => {
    expect(strokeLayout(20, 16384)).toEqual({ perRow: 8, width: 8 * TEXELS_PER_STROKE, rows: 3, capacity: 24 })
    // the path, colour, brush, stroke and role texels, and then the world path
    expect(TEXELS_PER_STROKE).toBe(2 * PATH_POINTS + 4)
  })

  it('widens the rows when the texture size would be exceeded: 40000 strokes at 2048 rows -> 20 per row', () => {
    const l = strokeLayout(40000, 2048)
    expect(l.perRow).toBe(20)
    expect(l.rows).toBe(2000)
    expect(l.rows).toBeLessThanOrEqual(2048)
    expect(l.capacity).toBeGreaterThanOrEqual(40000)
  })

  it('never goes past the device’s limit: a row is as many whole strokes as fit (64 texels: 3 strokes of 20), and the rows are at most 64', () => {
    // 10 strokes fit: 8 a row would be 160 texels, past 64, so 3 to a row, 4 rows
    expect(strokeLayout(10, 64)).toEqual({ perRow: 3, width: 60, rows: 4, capacity: 12 })
    // 300 strokes do not fit in 3 x 64: the rows are the limit's, and the capacity is what they hold
    expect(strokeLayout(300, 64)).toEqual({ perRow: 3, width: 60, rows: 64, capacity: 192 })
    // a limit that cannot hold a stroke's texels in a row holds none
    expect(strokeLayout(10, 19).capacity).toBe(0)
    expect(strokeLayout(10, 20)).toEqual({ perRow: 1, width: 20, rows: 10, capacity: 10 })
  })
})

describe('firstOfPlan: the strokes that fit', () => {
  it('keeps the first n of the plan, layer by layer: 5 strokes in layers {2, 2, 1} cut to 3 leave layers {2, 1, 0}', () => {
    const plan = planStrokes(batch([0, 0, 1, 1, 2], [5, 1, 7, 3, 2]))
    expect(Array.from(plan.layerStart.slice(0, 4))).toEqual([0, 2, 4, 5])
    const cut = firstOfPlan(plan, 3)
    expect(cut.count).toBe(3)
    expect(Array.from(cut.order)).toEqual(Array.from(plan.order.slice(0, 3)))
    expect(Array.from(cut.layerStart.slice(0, 4))).toEqual([0, 2, 3, 3])
    // nothing to cut: the same plan; nothing to keep: an empty one
    expect(firstOfPlan(plan, 9)).toBe(plan)
    expect(firstOfPlan(plan, 0).count).toBe(0)
  })
})

describe('packStrokes', () => {
  it('writes one stroke at hand-checked texel positions', () => {
    const b = batch([0], [1])
    b.path.set([5, 6, 15, 16, 25, 26, 35, 36, 45, 46, 55, 56, 65, 66, 75, 76])
    b.width.set([2, 4, 6, 8, 10, 12, 14, 16])
    b.colour.set([0.5, 0, 1])
    b.alpha[0] = 0.75
    b.load[0] = 0.9
    b.impasto[0] = 1.4
    b.bristles[0] = 9
    b.bristleVar[0] = 0.35
    b.dry[0] = 0.25
    b.wet[0] = 0.15
    b.endSoft[0] = 0.6
    b.role[0] = 3
    b.edge[0] = 2
    b.seed[0] = 0xabcdef12
    const plan = planStrokes(b)
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, plan, layout, out)
    // Texel k (k < 8): the path point and its width.
    expect(Array.from(out.subarray(0, 4))).toEqual([5, 6, 2, 0])
    expect(Array.from(out.subarray(7 * 4, 7 * 4 + 4))).toEqual([75, 76, 16, 0])
    // Colour: linear 0.5 encodes to sRGB 0.735357; 0 -> 0; 1 -> 1; then alpha.
    const c = 8 * 4
    expect(out[c]).toBeCloseTo(0.7353569830524495, 4)
    expect(out[c + 1]).toBe(0)
    expect(out[c + 2]).toBeCloseTo(1, 6)
    expect(out[c + 3]).toBeCloseTo(0.75, 6)
    // Brush parameters, stroke parameters, role and edge class.
    expect(Array.from(out.subarray(c + 4, c + 8)).map((v) => +v.toFixed(4))).toEqual([0.9, 1.4, 9, 0.35])
    expect(Array.from(out.subarray(c + 8, c + 12)).map((v) => +v.toFixed(4))).toEqual([0.25, 0.15, 0.6, 0xabcdef])
    expect(Array.from(out.subarray(c + 12, c + 16))).toEqual([3, 2, 0, 0])
  })

  it('packs the world path after the stroke’s own texels, and says whether there is one', () => {
    const b = batch([0, 0, 0], [3, 2, 1])
    // stroke 0: a world path, point k at (k + 1, 10 + k, 20 + k); stroke 1: none (all zero); stroke 2: a number that is not one
    for (let k = 0; k < PATH_POINTS; k++) b.worldPath.set([k + 1, 10 + k, 20 + k], 3 * k)
    b.worldPath[3 * PATH_POINTS * 2 + 4] = Number.NaN
    b.worldPath[3 * PATH_POINTS * 2] = 5
    const plan = planStrokes(b)
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, plan, layout, out)
    // planned farthest first: batch 0 (depth 3), then batch 1 (depth 2), then batch 2 (depth 1)
    const texel = (slot: number, k: number) => Array.from(out.subarray((slot * TEXELS_PER_STROKE + k) * 4, (slot * TEXELS_PER_STROKE + k) * 4 + 4))
    expect(Array.from(plan.order)).toEqual([0, 1, 2])
    // the role texel (PATH_POINTS + 3): role, edge class, has a world path
    expect(texel(0, PATH_POINTS + 3)[2]).toBe(1)
    expect(texel(1, PATH_POINTS + 3)[2]).toBe(0)
    expect(texel(2, PATH_POINTS + 3)[2]).toBe(0)
    // the world texels (PATH_POINTS + 4 + k): x, y, z, 0
    expect(texel(0, PATH_POINTS + 4)).toEqual([1, 10, 20, 0])
    expect(texel(0, PATH_POINTS + 4 + 7)).toEqual([8, 17, 27, 0])
    // a stroke with no world path has nothing in them
    expect(texel(1, PATH_POINTS + 4)).toEqual([0, 0, 0, 0])
  })

  it('packs a batch with no world path at all (an older caller) without one, untested', () => {
    const b = batch([0], [1]) as unknown as { worldPath?: Float32Array }
    delete b.worldPath
    const plan = planStrokes(b as never)
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    expect(() => packStrokes(b as never, plan, layout, out)).not.toThrow()
    expect(out[(PATH_POINTS + 3) * 4 + 2]).toBe(0)
  })

  it('puts the model’s linear colour through ONE sRGB encode on its way to a screen byte (no encode missing, none twice)', () => {
    // linear (0.2, 0.1, 0.05): sRGB 1.055 x 0.2^(1/2.4) - 0.055 = 0.4845, 0.3507 and 0.2478, which are the bytes 124, 89 and 63.
    // The first wiring was suspected of washing the paint out by a double or a missing encode: the colour is encoded here once,
    // the stroke shader blends in sRGB without encoding or decoding (shaders.test.ts), and the composite writes the sum.
    const b = batch([0], [1])
    b.colour.set([0.2, 0.1, 0.05], 0)
    const plan = planStrokes(b)
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, plan, layout, out)
    const c = 8 * 4
    expect(Array.from(out.subarray(c, c + 3)).map((v) => Math.round(v * 255))).toEqual([124, 89, 63])
    expect(out[c]).toBeCloseTo(0.4845, 3)
    // a stroke that covers its pixel whole (alpha 1, no wet pickup, flat canvas under it of byte 235) is the encoded byte
    // by the composite's own arithmetic: paint + canvas (1 - coverage)
    const al = 1
    const paper = 235 / 255
    expect(Math.round(255 * (out[c] * al + paper * (1 - al)))).toBe(124)
    // and at the brush's top opacity (0.96) the canvas shows through by 4%: 0.96 x 124 + 0.04 x 235 = 128.4
    expect(Math.round(255 * (out[c] * 0.96 + paper * 0.04))).toBe(128)
  })

  it('places the n-th stroke of the plan in the n-th slot, 20 texels along the row', () => {
    const b = batch([0, 0], [1, 9])
    b.path.fill(0)
    b.path[0] = 111 // stroke 0, point 0, x
    b.path[2 * PATH_POINTS] = 222 // stroke 1, point 0, x
    const plan = planStrokes(b) // farthest first: stroke 1 (depth 9), then stroke 0
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, plan, layout, out)
    expect(out[0]).toBe(222)
    expect(out[TEXELS_PER_STROKE * 4]).toBe(111)
  })

  it('turns a negative width into 0 and a stroke with a NaN into an empty one', () => {
    const b = batch([0, 0], [1, 2])
    b.width[0] = -3
    b.path[2 * PATH_POINTS + 3] = Number.NaN // stroke 1
    const plan = planStrokes(b) // stroke 1 first (depth 2), stroke 0 second
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, plan, layout, out)
    // The NaN stroke is collapsed to a point at the origin with no width.
    for (let k = 0; k < PATH_POINTS; k++) expect(Array.from(out.subarray(k * 4, k * 4 + 3))).toEqual([0, 0, 0])
    // The negative width of stroke 0 reads as 0.
    expect(out[TEXELS_PER_STROKE * 4 + 2]).toBe(0)
  })
})

describe('colour encoding', () => {
  it('encodes linear light to sRGB: 0 -> 0, 0.0031308 -> 0.040449936, 0.5 -> 0.735357, 1 -> 1', () => {
    expect(srgbEncode(0)).toBe(0)
    expect(srgbEncode(0.0031308)).toBeCloseTo(0.040449936, 6)
    expect(srgbEncode(0.5)).toBeCloseTo(0.7353569830524495, 9)
    expect(srgbEncode(1)).toBeCloseTo(1, 9)
  })

  it('the lookup version agrees with it to 1e-4 over [0, 1]', () => {
    let worst = 0
    for (let i = 0; i <= 1000; i++) worst = Math.max(worst, Math.abs(srgbEncodeFast(i / 1000) - srgbEncode(i / 1000)))
    expect(worst).toBeLessThan(1e-4)
  })
})

describe('per-role brush constants', () => {
  it('has four numbers for each of the eight roles, in ROLES order', () => {
    expect(ROLES.length).toBe(8)
    expect(ROLE_A.length).toBe(ROLES.length * 4)
    expect(ROLE_B.length).toBe(ROLES.length * 4)
  })

  it('keeps the mockup opacities: block .96, glaze .34 (a veil of .26 stays .26), dab .96', () => {
    const at = (role: string) => ROLES.indexOf(role as (typeof ROLES)[number]) * 4
    expect(ROLE_A[at('block')]).toBeCloseTo(0.96, 6)
    expect(ROLE_A[at('glaze')]).toBeCloseTo(0.34, 6)
    expect(ROLE_A[at('dab')]).toBeCloseTo(0.96, 6)
  })

  it('marks only the line role as crisp (exact data marks)', () => {
    ROLES.forEach((role, r) => expect(ROLE_B[r * 4 + 2]).toBe(role === 'line' ? 1 : 0))
  })
})

describe('the strokes of the hidden pass (a baked frame’s dashed data lines)', () => {
  // five strokes: batch index 0..4, layers 1 0 1 0 2, depths 3 5 7 1 2, planned in the order 1 3 2 0 4
  const hiddenBatch = (style: number[]): StrokeBatch => {
    const b = batch([1, 0, 1, 0, 2], [3, 5, 7, 1, 2])
    b.hidden = Uint8Array.from(style)
    return b
  }

  it('lists the dashed strokes in drawing order after the planned ones, and leaves the layers alone', () => {
    const plan = planStrokes(hiddenBatch([HIDDEN_DASHED, HIDDEN_NA, HIDDEN_NONE, HIDDEN_DASHED, HIDDEN_DASHED]))
    expect(Array.from(plan.order)).toEqual([1, 3, 2, 0, 4])
    expect(Array.from(plan.layerStart)).toEqual([0, 2, 4, 5, 5, 5, 5, 5, 5])
    // 3, 0 and 4 in the order they are planned
    expect(Array.from(plan.hidden ?? [])).toEqual([3, 0, 4])
  })

  it('has no list for a batch with no hidden array (the per-frame model’s), or one with nothing dashed', () => {
    expect(planStrokes(batch([1, 0], [1, 2])).hidden).toBeUndefined()
    expect('hidden' in planStrokes(batch([1, 0], [1, 2]))).toBe(false)
    expect(planStrokes(hiddenBatch([HIDDEN_NONE, HIDDEN_NA, HIDDEN_NONE, HIDDEN_NONE, HIDDEN_NA])).hidden).toBeUndefined()
    // a hidden array shorter than the batch is no hidden array
    const short = batch([1, 0], [1, 2])
    short.hidden = Uint8Array.from([HIDDEN_DASHED])
    expect(planStrokes(short).hidden).toBeUndefined()
  })

  it('does not list a stroke that is not drawn (a layer outside LAYER_ORDER)', () => {
    const b = batch([0, 200, 1], [1, 2, 3])
    b.hidden = Uint8Array.from([HIDDEN_DASHED, HIDDEN_DASHED, HIDDEN_NA])
    expect(Array.from(planStrokes(b).hidden ?? [])).toEqual([0])
  })

  it('packs them again in the slots after the planned ones: slot count + k holds the same texels as the stroke does in its own slot', () => {
    const b = hiddenBatch([HIDDEN_DASHED, HIDDEN_NA, HIDDEN_NONE, HIDDEN_DASHED, HIDDEN_DASHED])
    for (let i = 0; i < 5; i++) {
      b.colour.set([0.1 * (i + 1), 0.2, 0.3], 3 * i)
      b.seed[i] = 100 + i
      for (let k = 0; k < PATH_POINTS; k++) b.worldPath.set([i + 1, k + 1, 7], 3 * PATH_POINTS * i + 3 * k)
    }
    const whole = planStrokes(b)
    const layout = strokeLayout(whole.count + (whole.hidden?.length ?? 0), 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, whole, layout, out)
    const slot = (n: number) => Array.from(out.subarray(n * TEXELS_PER_STROKE * 4, (n + 1) * TEXELS_PER_STROKE * 4))
    // planned order 1 3 2 0 4, then the dashed 3 0 4
    const slotOf = (batchIndex: number) => Array.from(whole.order).indexOf(batchIndex)
    expect(slot(5)).toEqual(slot(slotOf(3)))
    expect(slot(6)).toEqual(slot(slotOf(0)))
    expect(slot(7)).toEqual(slot(slotOf(4)))
    // and they are real: stroke 3's world path is in them
    expect(slot(5).slice((PATH_POINTS + 4) * 4, (PATH_POINTS + 4) * 4 + 4)).toEqual([4, 1, 7, 0])
  })

  it('packs a batch with none exactly as before: the texels of the planned slots only', () => {
    const b = batch([1, 0], [1, 2])
    const plan = planStrokes(b)
    const layout = strokeLayout(plan.count, 4096)
    const out = new Float32Array(layout.width * layout.rows * 4)
    packStrokes(b, plan, layout, out)
    // slot 2 (no stroke) is untouched
    expect(Array.from(out.subarray(2 * TEXELS_PER_STROKE * 4, 3 * TEXELS_PER_STROKE * 4)).every((v) => v === 0)).toBe(true)
  })

  it('drops them first when the texture is short: firstOfPlan keeps the planned strokes before the hidden ones', () => {
    const plan = planStrokes(hiddenBatch([HIDDEN_DASHED, HIDDEN_NA, HIDDEN_NONE, HIDDEN_DASHED, HIDDEN_DASHED]))
    // room for everything: the same plan; room for 6 of the 8 slots: the five planned and one hidden
    expect(firstOfPlan(plan, 8)).toBe(plan)
    const six = firstOfPlan(plan, 6)
    expect(six.count).toBe(5)
    expect(Array.from(six.hidden ?? [])).toEqual([3])
    // room for 5: all planned, no hidden; for 3: three planned, none hidden
    expect(firstOfPlan(plan, 5).hidden).toBeUndefined()
    expect(firstOfPlan(plan, 5).count).toBe(5)
    const three = firstOfPlan(plan, 3)
    expect(three.count).toBe(3)
    expect(three.hidden).toBeUndefined()
  })
})
