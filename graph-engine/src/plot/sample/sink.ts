// Where the adaptive core's segments become chains (calc P2). The core says "connect A
// to B" and the sink keeps a pen: a segment that starts where the pen is extends the
// chain, any other starts a new one, so the core never has to say "start" and a chain
// only ever breaks where it was told to lift or where it left the clip box.
//
// The clip box is the view widened by the overscan, so it is not the picture's edge:
// a curve that leaves it ends its chain at the boundary, and one that enters starts a
// chain there, with a parameter interpolated along the segment (Liang-Barsky). Leaving
// the box is where the sampler stops looking, not a fact about the curve, so it records
// no break. A break is mathematics and comes through addBreak.
//
// What comes out is always finite and inside the box, and a chain has at least two
// vertices.
import type { Bounds, Break, BreakKind, Chain } from '../../scene/types'

export class ChainSink {
  private readonly clip: Bounds
  private readonly done: Chain[] = []
  private readonly found: Break[] = []
  // the chain being drawn, x and y interleaved, and the parameter at each vertex
  private xy: number[] = []
  private ts: number[] = []
  // The pen: the last vertex of the open chain, when the chain can be continued from it.
  // It is a position and a parameter, compared exactly: the core hands the same doubles
  // to both neighbouring intervals. Not set after a segment that left the box.
  private penDown = false
  private penX = 0
  private penY = 0
  private penT = 0
  // the parametric range of the part of a segment inside the box (scratch for trim)
  private u0 = 0
  private u1 = 1

  constructor(clip: Bounds) {
    this.clip = clip
  }

  // Connects a = (xa, ya) at parameter ta to b = (xb, yb) at tb, clipped to the box.
  segment(xa: number, ya: number, ta: number, xb: number, yb: number, tb: number): void {
    if (!(Number.isFinite(xa) && Number.isFinite(ya) && Number.isFinite(ta) && Number.isFinite(xb) && Number.isFinite(yb) && Number.isFinite(tb))) {
      // there is no segment to a point that is not there
      this.lift()
      return
    }
    const dx = xb - xa
    const dy = yb - ya
    if (!(Number.isFinite(dx) && Number.isFinite(dy))) {
      // the ends are on opposite sides of the doubles and the difference overflows: go in two halves
      const xm = xa / 2 + xb / 2
      const ym = ya / 2 + yb / 2
      const tm = ta / 2 + tb / 2
      this.segment(xa, ya, ta, xm, ym, tm)
      this.segment(xm, ym, tm, xb, yb, tb)
      return
    }
    const { xMin, xMax, yMin, yMax } = this.clip
    this.u0 = 0
    this.u1 = 1
    if (!(this.trim(-dx, xa - xMin) && this.trim(dx, xMax - xa) && this.trim(-dy, ya - yMin) && this.trim(dy, yMax - ya))) return

    const enters = this.u0 > 0
    const leaves = this.u1 < 1
    // The pen is only ever at a vertex inside the box, so a segment that enters is never a continuation.
    if (enters || !(this.penDown && this.penT === ta && this.penX === xa && this.penY === ya)) {
      this.lift()
      this.add(enters ? this.inX(xa + this.u0 * dx) : xa, enters ? this.inY(ya + this.u0 * dy) : ya, enters ? ta + this.u0 * (tb - ta) : ta)
    }
    if (leaves) {
      this.add(this.inX(xa + this.u1 * dx), this.inY(ya + this.u1 * dy), ta + this.u1 * (tb - ta))
      this.lift()
    } else {
      this.add(xb, yb, tb)
      this.penDown = true
      this.penX = xb
      this.penY = yb
      this.penT = tb
    }
  }

  // Ends the chain being drawn: the next segment starts another.
  lift(): void {
    this.penDown = false
    // (the core lifts at every culled interval, almost all of them with nothing open)
    if (this.ts.length === 0) return
    if (this.ts.length >= 2) this.done.push({ xy: Float64Array.from(this.xy), param: Float64Array.from(this.ts), closed: false })
    this.xy = []
    this.ts = []
  }

  // Records where the curve is mathematically interrupted, in its own parameter.
  addBreak(t: number, kind: BreakKind): void {
    this.found.push({ at: t, kind })
  }

  // The chains so far, in the order they were drawn, the open one included. Reading does
  // not end it.
  chains(): Chain[] {
    const out = this.done.slice()
    if (this.ts.length >= 2) out.push({ xy: Float64Array.from(this.xy), param: Float64Array.from(this.ts), closed: false })
    return out
  }

  breaks(): Break[] {
    return this.found.slice()
  }

  // One edge of the box: the part of the segment that satisfies p * u <= q. False when none of it does.
  private trim(p: number, q: number): boolean {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > this.u1) return false
      if (r > this.u0) this.u0 = r
    } else {
      if (r < this.u0) return false
      if (r < this.u1) this.u1 = r
    }
    return true
  }

  // A clipped coordinate is a rounded one, and may be a hair outside the box it was cut at.
  private inX(x: number): number {
    return x < this.clip.xMin ? this.clip.xMin : x > this.clip.xMax ? this.clip.xMax : x
  }

  private inY(y: number): number {
    return y < this.clip.yMin ? this.clip.yMin : y > this.clip.yMax ? this.clip.yMax : y
  }

  // A vertex the chain already ends with is not repeated: a segment of no extent adds nothing.
  private add(x: number, y: number, t: number): void {
    const n = this.ts.length
    if (n > 0 && this.ts[n - 1] === t && this.xy[2 * n - 2] === x && this.xy[2 * n - 1] === y) return
    this.xy.push(x, y)
    this.ts.push(t)
  }
}
