// The one source of randomness a style may use.
//
// Every random choice a style makes — a wobble, an overshoot, a dot of chalk
// dust — comes from a generator seeded by the IDENTITY of what is being drawn
// (its statement, its object, which piece of it) plus the style's `seed`
// setting. So the same figure in the same style always draws the same way,
// two different strokes never share a wobble, and changing the seed rerolls
// everything at once while staying deterministic.
//
// The algorithm, documented because figures depend on it byte for byte:
//   1. the identity string, then "|", then the seed in decimal, is hashed with
//      32-bit FNV-1a over its UTF-16 code units;
//   2. that hash seeds mulberry32, a small, fast, well-mixed 32-bit generator.
// Changing either reshuffles every styled figure ever drawn.

export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// mulberry32: one 32-bit state, one multiply-xorshift round per draw.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Random {
  // Uniform in [0, 1).
  next(): number
  // Uniform in [min, max).
  range(min: number, max: number): number
  // A whole number in [min, max], both ends included.
  int(min: number, max: number): number
  // -1 or 1.
  sign(): number
  // Roughly normal, mean 0, standard deviation 1 (sum of four uniforms).
  gauss(): number
}

export function randomFor(identity: string, seed = 0): Random {
  const next = mulberry32(hashString(`${identity}|${seed}`))
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss: () => (next() + next() + next() + next() - 2) * Math.sqrt(3),
  }
}

// Smooth value noise over [0, 1]: `knots` random values in [-1, 1], evenly
// spaced, joined by cosine interpolation. Continuous, bounded by 1, and cheap —
// the long, gentle waver of a hand-drawn line rather than jitter.
export function smoothNoise(random: Random, knots: number): (t: number) => number {
  const count = Math.max(2, Math.round(knots))
  const values = Array.from({ length: count + 1 }, () => random.range(-1, 1))
  return (t: number) => {
    const x = Math.min(1, Math.max(0, t)) * count
    const i = Math.min(count - 1, Math.floor(x))
    const f = x - i
    const blend = (1 - Math.cos(f * Math.PI)) / 2
    return values[i] * (1 - blend) + values[i + 1] * blend
  }
}
