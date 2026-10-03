// A growing list of strokes in the StrokeBatch's own layout (the frame's own strokes: the silhouettes, the points and the arrowheads; frame.ts
// merges them into the batch beside the baked strokes). The arrays are kept between frames and grown by doubling: a frame that fits in them
// allocates nothing.

import { PATH_POINTS } from '../types'

const P = PATH_POINTS

export class StrokeList {
  count = 0
  // How many times an array has had to be made (a test counts them: after the first frames there are no more).
  allocations = 0
  private cap = 0
  role = new Uint8Array(0)
  layer = new Uint8Array(0)
  path = new Float32Array(0)
  width = new Float32Array(0)
  depth = new Float32Array(0)
  colour = new Float32Array(0)
  alpha = new Float32Array(0)
  load = new Float32Array(0)
  impasto = new Float32Array(0)
  bristles = new Float32Array(0)
  bristleVar = new Float32Array(0)
  dry = new Float32Array(0)
  wet = new Float32Array(0)
  endSoft = new Float32Array(0)
  edge = new Uint8Array(0)
  seed = new Uint32Array(0)
  worldPath = new Float32Array(0)
  worldNormal = new Float32Array(0)
  hidden = new Uint8Array(0)

  clear(): void {
    this.count = 0
  }

  // A new stroke's index (its slots are whatever the last frame left in them: the caller writes every one).
  push(): number {
    if (this.count >= this.cap) this.grow(Math.max(64, 2 * this.cap))
    return this.count++
  }

  private grow(cap: number): void {
    const f = <T extends Float32Array | Uint8Array | Uint32Array>(a: T, per: number): T => {
      const out = new (a.constructor as new (n: number) => T)(per * cap)
      out.set(a)
      this.allocations++
      return out
    }
    this.role = f(this.role, 1)
    this.layer = f(this.layer, 1)
    this.path = f(this.path, 2 * P)
    this.width = f(this.width, P)
    this.depth = f(this.depth, 1)
    this.colour = f(this.colour, 3)
    this.alpha = f(this.alpha, 1)
    this.load = f(this.load, 1)
    this.impasto = f(this.impasto, 1)
    this.bristles = f(this.bristles, 1)
    this.bristleVar = f(this.bristleVar, 1)
    this.dry = f(this.dry, 1)
    this.wet = f(this.wet, 1)
    this.endSoft = f(this.endSoft, 1)
    this.edge = f(this.edge, 1)
    this.seed = f(this.seed, 1)
    this.worldPath = f(this.worldPath, 3 * P)
    this.worldNormal = f(this.worldNormal, 3)
    this.hidden = f(this.hidden, 1)
    this.cap = cap
  }
}
