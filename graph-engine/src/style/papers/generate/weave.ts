// A plain-weave thread field with irregular threads and slubs, and the gesso
// priming that fills its valleys. Ported from the approved mockup (papers.js
// weaveField, painter.js getCanvasTile, papers.js buildLinen).
//
// Every thread is its own wandering, swelling, slubbed ribbon running the
// whole tile, so the weave tiles by construction: periodic 1D noise along each
// thread, slubs added with wrap-around distance, and thread N-1 meeting
// thread 0 across the seam.

import { periodic1D, scaleCells } from './noise'
import type { Random } from '../../random'

export interface WeaveSpec {
  // Texels from one thread to the next (the thread count is size / pitch).
  pitch: number
  width: [number, number] // thread width, as a fraction of the pitch
  fatP: number // chance a thread is a fat one
  narrowP: number // chance a (not fat) thread is a narrow one
  thick: number // swell of a thread along its length
  wander: number // sideways wander, as a fraction of the pitch
  jit: number // standard deviation of a thread's resting offset
  slubP: number // chance a thread carries slubs
  slubAmp: [number, number]
  slubSig: [number, number] // texels
  bright: [number, number] // thread brightness
  occl: number // brightness left in a valley
  streak: number // brightness variation along a thread
}

export interface WeaveField {
  // Height of whatever thread is on top: 0 in a gap, 1 on a thread crown.
  H: Float32Array
  // Brightness factor around 1: thread colour, occlusion in the valleys, streaking.
  K: Float32Array
}

interface Direction {
  wander: Float32Array // N * size: sideways offset of thread j at sample x
  inv: Float32Array // N * size: 1 / half width
  bright: Float32Array // N * size: brightness
  jit: Float32Array // N: resting offset
}

// The gesso priming fills the weave's valleys: heights below `level` are
// raised by `fill` of their distance to it.
export function prime(H: Float32Array, level: number, fill: number): void {
  for (let i = 0; i < H.length; i++) H[i] += fill * Math.max(0, level - H[i])
}

// A slub: a Gaussian swelling of a thread, `amp` high and `sigma` texels wide, centred on `centre`. The
// thread is a loop, so the swelling spills over the tile's edge onto the other side, and no texel is
// counted twice however wide it is.
export function addSlub(thick: Float32Array, centre: number, sigma: number, amp: number): void {
  const size = thick.length
  const reach = Math.ceil(sigma * 3.5)
  const count = Math.min(size, 2 * reach + 1)
  const start = Math.round(centre) - Math.floor(count / 2)
  for (let k = 0; k < count; k++) {
    const x = (((start + k) % size) + size) % size
    const dx = Math.abs(x - centre)
    const dist = dx > size / 2 ? size - dx : dx
    thick[x] += amp * Math.exp(-(dist * dist) / (2 * sigma * sigma))
  }
}

// The standard deviation of periodic1D noise, s1 + s2 / 2: random knots of variance 1/3 blended by the quintic fade
// give 181/693 per octave (the mean of (1 - u)^2 + u^2 is 181/231, and u^3(6u^2 - 15u + 10) integrates to 181/462
// squared), and the second octave at half weight adds a quarter of it.
const STREAK_SD = Math.sqrt((181 / 693) * 1.25)

const interlace = (over: number) => 0.42 + 0.58 * over * over * (3 - 2 * over)

function makeDirection(random: Random, N: number, size: number, pitch: number, spec: WeaveSpec): Direction {
  const wander = new Float32Array(N * size)
  const inv = new Float32Array(N * size)
  const bright = new Float32Array(N * size)
  const jit = new Float32Array(N)
  const thick = new Float32Array(size)
  for (let j = 0; j < N; j++) {
    const wan = periodic1D(random, scaleCells(4 + (j % 4), size), size)
    const swell = periodic1D(random, scaleCells(14 + (j % 9), size), size)
    let w = random.range(spec.width[0], spec.width[1])
    if (random.next() < spec.fatP) w *= random.range(1.35, 1.8)
    else if (random.next() < spec.narrowP) w *= 0.72
    for (let x = 0; x < size; x++) {
      thick[x] = 1 + spec.thick * swell[x]
      wander[j * size + x] = wan[x] * pitch * spec.wander
    }
    if (random.next() < spec.slubP) {
      const blobs = random.int(1, 2)
      for (let b = 0; b < blobs; b++) {
        const c = random.next() * size
        const sg = random.range(spec.slubSig[0], spec.slubSig[1])
        const amp = random.range(spec.slubAmp[0], spec.slubAmp[1])
        addSlub(thick, c, sg, amp)
      }
    }
    for (let x = 0; x < size; x++) inv[j * size + x] = 1 / (0.5 * pitch * w * thick[x] * 1.04)
    // A thread's brightness along its length: slow, two octaves, scaled so `streak` is its standard deviation.
    const s1 = periodic1D(random, scaleCells(10, size), size)
    const s2 = periodic1D(random, scaleCells(20, size), size)
    const tb = random.range(spec.bright[0], spec.bright[1])
    for (let x = 0; x < size; x++) bright[j * size + x] = tb * (1 + (spec.streak * (s1[x] + 0.5 * s2[x])) / STREAK_SD)
    jit[j] = Math.min(2 * spec.jit, Math.max(-2 * spec.jit, random.gauss() * spec.jit)) * pitch
  }
  return { wander, inv, bright, jit }
}

export function weaveField(random: Random, size: number, spec: WeaveSpec): WeaveField {
  // An EVEN number of threads, so the over/under alternation meets itself across the wrap.
  const N = 2 * Math.max(2, Math.round(size / spec.pitch / 2))
  const pitch = size / N
  // The tile's origin sits half a thread into the cloth, so the wrap seam runs
  // down the middle of a thread (where it is smoothest) and not along the edge
  // between two. The tile is periodic, so this only chooses where it is cut.
  const shift = Math.round(pitch / 2)
  const rows = makeDirection(random, N, size, pitch, spec)
  const cols = makeDirection(random, N, size, pitch, spec)

  // Where a thread goes over or under is (-1)^j times a sine of the position
  // across the weave, so the interlace factor is two tables per axis.
  const rowEven = new Float32Array(size) // over/under factor of an even row thread at column x
  const rowOdd = new Float32Array(size)
  const colEven = new Float32Array(size) // ... of an even column thread at row y
  const colOdd = new Float32Array(size)
  // Where weave coordinate t lands in the tile: the tile is cut `shift` texels in.
  const place = new Int32Array(size)
  for (let i = 0; i < size; i++) {
    const s = Math.sin((Math.PI * (i + 0.5)) / pitch)
    rowEven[i] = interlace(0.5 + 0.5 * s)
    rowOdd[i] = interlace(0.5 - 0.5 * s)
    colEven[i] = interlace(0.5 - 0.5 * s)
    colOdd[i] = interlace(0.5 + 0.5 * s)
    place[i] = i >= shift ? i - shift : i - shift + size
  }

  // Each thread is laid down over the texels it covers, the one on top at a
  // texel being the highest: horizontal threads first, then vertical ones, which
  // only win where they are strictly higher. A thread covers about 1.2 texels
  // across its width per texel along it, so this evaluates a fifth of what asking
  // every texel for its three nearest threads in both directions would.
  const H = new Float32Array(size * size) // height of whatever is on top: 0 where nothing is
  const B = new Float32Array(size * size).fill(1) // brightness of whatever is on top
  for (let j = 0; j < N; j++) {
    const yc0 = (j + 0.5) * pitch + rows.jit[j]
    const base = j * size
    const odd = j & 1
    for (let xs = 0; xs < size; xs++) {
      const inv = rows.inv[base + xs]
      const yc = yc0 + rows.wander[base + xs]
      const half = 1 / inv
      const factor = odd ? rowOdd[xs] : rowEven[xs]
      const bright = rows.bright[base + xs]
      const xo = place[xs]
      const last = Math.floor(yc + half - 0.5)
      for (let ys = Math.ceil(yc - half - 0.5); ys <= last; ys++) {
        const d = Math.abs(ys + 0.5 - yc) * inv
        if (d >= 1) continue
        const g = Math.sqrt(1 - d * d) * factor
        const idx = place[ys < 0 ? ys + size : ys >= size ? ys - size : ys] * size + xo
        if (g > H[idx]) {
          H[idx] = g
          B[idx] = bright
        }
      }
    }
  }
  for (let i = 0; i < N; i++) {
    const xc0 = (i + 0.5) * pitch + cols.jit[i]
    const base = i * size
    const odd = i & 1
    for (let ys = 0; ys < size; ys++) {
      const inv = cols.inv[base + ys]
      const xc = xc0 + cols.wander[base + ys]
      const half = 1 / inv
      const factor = odd ? colOdd[ys] : colEven[ys]
      const bright = cols.bright[base + ys]
      const rowStart = place[ys] * size
      const last = Math.floor(xc + half - 0.5)
      for (let xs = Math.ceil(xc - half - 0.5); xs <= last; xs++) {
        const d = Math.abs(xs + 0.5 - xc) * inv
        if (d >= 1) continue
        const g = Math.sqrt(1 - d * d) * factor
        const idx = rowStart + place[xs < 0 ? xs + size : xs >= size ? xs - size : xs]
        if (g > H[idx]) {
          H[idx] = g
          B[idx] = bright
        }
      }
    }
  }

  // The brightness factor: the thread's own, darkened in the valleys.
  const occl = spec.occl
  for (let i = 0; i < H.length; i++) B[i] *= occl + (1 - occl) * Math.min(1, H[i] * 1.25)
  return { H, K: B }
}
