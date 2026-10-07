// A WHITEBOARD: a glossy melamine sheet. A faint large-scale gloss (broad swells of light, and one soft
// sheen band across the tile on the diagonal), a very fine surface, and the GHOSTS of what was wiped off,
// three to six to a tile: faint arcs, scribbled-in patches and underlines, each a smeared, streaky shadow
// a hair darker than the board (a lightness of -0.01 to -0.03), some with the barest stain of the
// marker's colour. The relief is nearly flat: the board is smooth.

import { fbmFieldN, scaleCells, upsamplePeriodic } from '../noise'
import type { Structure } from '../structure'
import type { Random } from '../../../random'
import { addLayer, blurPeriodic, centreOffsets, NEUTRAL, stageOf, strokeMask } from './support'

const TAU = Math.PI * 2

// The polyline of one ghost, as flat x, y, ... (it may run past the tile: it wraps).
function ghostLine(random: Random, size: number): number[] {
  const x = random.next() * size
  const y = random.next() * size
  const pts: number[] = []
  const pick = random.next()
  if (pick < 0.4) {
    // An arc: part of a circle, its radius wavering a little.
    const radius = random.range(35, 110)
    const start = random.next() * TAU
    const sweep = random.range(1.4, 3.6)
    const steps = 28
    const wobble = random.range(0.02, 0.06)
    const phase = random.next() * TAU
    for (let k = 0; k <= steps; k++) {
      const a = start + (sweep * k) / steps
      const r = radius * (1 + wobble * Math.sin(phase + k * 0.7))
      pts.push(x + r * Math.cos(a), y + r * Math.sin(a))
    }
  } else if (pick < 0.75) {
    // A scribbled-in patch: back and forth, a little further down each time.
    const width = random.range(40, 90)
    const height = random.range(25, 60)
    const turns = random.int(5, 12)
    for (let k = 0; k <= turns; k++) {
      const across = k % 2 === 0 ? 0 : width
      pts.push(x + across + random.range(-4, 4), y + (height * k) / turns + random.range(-2.5, 2.5))
    }
  } else {
    // An underline or a stroke: nearly straight, a slow waver along it.
    const length = random.range(60, 170)
    const angle = random.range(-0.5, 0.5)
    const phase = random.next() * TAU
    const amp = random.range(1.5, 5)
    const steps = 18
    for (let k = 0; k <= steps; k++) {
      const t = (length * k) / steps
      const bend = amp * Math.sin(phase + (k * TAU) / steps)
      pts.push(x + t * Math.cos(angle) - bend * Math.sin(angle), y + t * Math.sin(angle) + bend * Math.cos(angle))
    }
  }
  return pts
}

export function buildWhiteboard(size: number, seed: string): Structure {
  const off = new Float32Array(3 * size * size)

  // The gloss: broad swells of light, and one soft diagonal sheen across the tile.
  const gloss = fbmFieldN(stageOf('whiteboard', seed, 'gloss'), size, { cx: scaleCells(2, size), octaves: 2, grid: 64 })
  addLayer(off, size, gloss, 0.005, NEUTRAL)
  const phase = stageOf('whiteboard', seed, 'sheen').next() * TAU
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) off[3 * (y * size + x)] += 0.004 * Math.sin(TAU * ((x + y) / size) + phase)
  }

  // The surface: a very fine texture, barely there.
  const fine = fbmFieldN(stageOf('whiteboard', seed, 'surface'), size, { cx: scaleCells(300, size), octaves: 2 })
  addLayer(off, size, fine, 0.002, NEUTRAL)

  // The ghosts.
  const random = stageOf('whiteboard', seed, 'ghosts')
  const smear = fbmFieldN(stageOf('whiteboard', seed, 'smear'), size, { cx: scaleCells(40, size), cy: scaleCells(14, size), octaves: 2, grid: 256 })
  const smearFull = upsamplePeriodic(smear.data, smear.w, smear.h, size, size)
  const count = random.int(3, 6)
  for (let g = 0; g < count; g++) {
    const mask = blurPeriodic(strokeMask(size, [ghostLine(random, size)], random.range(3.5, 7)), size, 2, 1)
    const depth = random.range(0.01, 0.03)
    const stain = random.range(-0.004, 0.004)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 0) continue
      const patchy = Math.min(1, Math.max(0, 0.6 + 0.35 * smearFull[i]))
      const a = mask[i] * patchy
      off[3 * i] -= depth * a
      off[3 * i + 1] += stain * a
      off[3 * i + 2] -= 0.5 * stain * a
    }
  }

  const deviation = new Float32Array(size * size)
  const fineFull = upsamplePeriodic(fine.data, fine.w, fine.h, size, size)
  for (let i = 0; i < deviation.length; i++) deviation[i] = 0.03 * fineFull[i]

  centreOffsets(off)
  return { size, offsets: off, deviation }
}
