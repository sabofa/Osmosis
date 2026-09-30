import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import { pointOn, polylineChain, type Chain } from '../path'
import { FILL_TYPES, type FillSettings, type FillType } from '../tokens'
import { FILLS } from './index'
import { insideRegion, MARK_BUDGET, regionPolygons } from './region'
import type { FillMark } from './types'

// The seven fills, held to their rules: marks inside the region (the hole of
// an annulus included), hatching at its angle and spacing, determinism.

const SQUARE: Chain[] = [polylineChain([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }], true)]
const circle = (r: number, clockwise: boolean): Chain => ({
  pieces: [{ kind: 'arc', center: { x: 100, y: 100 }, radius: r, start: 0, end: clockwise ? -2 * Math.PI : 2 * Math.PI }],
  closed: true,
})
// An annulus: outer radius 90, a hole of radius 45.
const ANNULUS: Chain[] = [circle(90, false), circle(45, true)]
// A region with two separate loops, neither a hole in the other.
const TWO_LOOPS: Chain[] = [
  polylineChain([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }, { x: 0, y: 0 }], true),
  polylineChain([{ x: 150, y: 0 }, { x: 230, y: 0 }, { x: 230, y: 80 }, { x: 150, y: 80 }, { x: 150, y: 0 }], true),
]

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
}

const settingsFor = (type: FillType, overrides: Partial<FillSettings> = {}): FillSettings => ({ type, angle: 30, spacing: 10, opacity: 0.5, roughness: 0, ...overrides })

const fill = (type: FillType, outline: Chain[], overrides: Partial<FillSettings> = {}, identity = 's1/R') =>
  FILLS[type].draw({ outline, settings: settingsFor(type, overrides), random: randomFor(identity, 0) }).marks

// Where a fill puts ink: its line pieces' midpoints and its dots' centres.
function inkPoints(marks: readonly FillMark[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const mark of marks) {
    if (mark.kind === 'lines') for (const chain of mark.chains) for (const piece of chain.pieces) out.push(pointOn(piece, 0.5))
    if (mark.kind === 'dots') out.push(...mark.dots.map((d) => d.at))
  }
  return out
}

// Rule: "roughness 0 is byte-identical for every fill". Pinned at the
// commit fill roughness was added on (scratch-hashfills.ts, run against the
// pre-roughness code, this session) — the proof that the fills below still
// draw exactly as they did before roughness existed. A change to any fill's
// roughness-0 output turns one of these red.
const ROUGHNESS_ZERO_HASHES: Record<string, string> = {
  'flat square': 'ea44c71c4cb542debf08',
  'flat annulus': 'ea44c71c4cb542debf08',
  'flat two-loops': 'ea44c71c4cb542debf08',
  'hatch square': '556b13dbdf06f202e3be',
  'hatch annulus': 'a41e588b964a6e6bf712',
  'hatch two-loops': 'a8a9726872230c587181',
  'crosshatch square': 'b0610b79c3c48d286766',
  'crosshatch annulus': 'a97ecb5ae64ed2339964',
  'crosshatch two-loops': '8f8207adc1cd4ffc941f',
  'stipple square': '89581b1a20792eba1b2e',
  'stipple annulus': 'c95c4ec87849eb3fa5cf',
  'stipple two-loops': '12a34186fad0b98b2936',
  'scribble square': '692c9aa1d614dc26217d',
  'scribble annulus': 'f2b86d788fc4ad7fc0d1',
  'scribble two-loops': 'e3588f0f008f382aade0',
  'wash square': 'e765943ee720f8d25706',
  'wash annulus': 'e765943ee720f8d25706',
  'wash two-loops': 'e765943ee720f8d25706',
  'none square': '9ae37bfe3cc0d2ed80d5',
  'none annulus': '9ae37bfe3cc0d2ed80d5',
  'none two-loops': '9ae37bfe3cc0d2ed80d5',
}

describe('roughness 0 is byte-identical to before roughness existed', () => {
  const shapes: [string, Chain[]][] = [
    ['square', SQUARE],
    ['annulus', ANNULUS],
    ['two-loops', TWO_LOOPS],
  ]
  for (const type of FILL_TYPES) {
    for (const [shapeName, outline] of shapes) {
      it(`${type} on ${shapeName}`, async () => {
        const random = randomFor(`s1/${type}/${shapeName}`, 0)
        const out = FILLS[type].draw({ outline, settings: settingsFor(type, { roughness: 0 }), random })
        expect(await sha(JSON.stringify(out))).toBe(ROUGHNESS_ZERO_HASHES[`${type} ${shapeName}`])
      })
    }
  }
})

describe('every fill', () => {
  for (const type of FILL_TYPES) {
    describe(type, () => {
      it('is deterministic', () => {
        expect(fill(type, SQUARE)).toEqual(fill(type, SQUARE))
        expect(fill(type, ANNULUS)).toEqual(fill(type, ANNULUS))
      })

      it('puts its marks inside the region, and none in the annulus’s hole', () => {
        const polygons = regionPolygons(ANNULUS)
        for (const p of inkPoints(fill(type, ANNULUS))) {
          const r = Math.hypot(p.x - 100, p.y - 100)
          expect(r, `${type} at ${p.x},${p.y}`).toBeLessThanOrEqual(90 + 1e-6)
          expect(r, `${type} at ${p.x},${p.y}`).toBeGreaterThanOrEqual(45 - 1e-6)
          expect(insideRegion(p, polygons) || Math.abs(r - 45) < 1e-6 || Math.abs(r - 90) < 1e-6).toBe(true)
        }
      })

      it('writes only finite numbers', () => {
        expect(JSON.stringify(fill(type, ANNULUS))).not.toMatch(/null|NaN|Infinity/)
      })
    })
  }

  it('none draws nothing, and flat is the region itself', () => {
    expect(fill('none', SQUARE)).toEqual([])
    expect(fill('flat', SQUARE)).toEqual([{ kind: 'area' }])
  })

  it('stipple is dots, scribble is one zig-zag stroke per run, wash is a textured area with a darker edge', () => {
    expect(fill('stipple', SQUARE).map((m) => m.kind)).toEqual(['dots'])
    const scribble = fill('scribble', SQUARE)
    expect(scribble.map((m) => m.kind)).toEqual(['lines'])
    // A square is one run: one long stroke going back and forth.
    if (scribble[0].kind === 'lines') {
      expect(scribble[0].chains).toHaveLength(1)
      expect(scribble[0].chains[0].pieces.length).toBeGreaterThan(20)
    }
    expect(fill('wash', SQUARE)).toEqual([{ kind: 'area', texture: 'wash' }, expect.objectContaining({ kind: 'edge' })])
  })

  it('draws a different stipple for a different identity', () => {
    expect(fill('stipple', SQUARE, {}, 's1/R')).not.toEqual(fill('stipple', SQUARE, {}, 's2/R'))
  })
})

// The direction of a straight hatch line, in degrees anticlockwise from the
// page's horizontal (y points down on the page), folded into [0, 180).
function directionOf(chain: Chain): number {
  const piece = chain.pieces[0]
  if (piece.kind !== 'line') throw new Error('hatch lines are straight')
  const degrees = (Math.atan2(-(piece.to.y - piece.from.y), piece.to.x - piece.from.x) * 180) / Math.PI
  return ((degrees % 180) + 180) % 180
}

// Signed distance of a line's midpoint across the hatch direction.
function offsetOf(chain: Chain, angle: number): number {
  const m = pointOn(chain.pieces[0], 0.5)
  const theta = (angle * Math.PI) / 180
  return m.x * Math.sin(theta) + m.y * Math.cos(theta)
}

describe('hatching', () => {
  for (const angle of [0, 30, 45, 90, 135]) {
    it(`follows angle ${angle} and spacing 10`, () => {
      const marks = fill('hatch', SQUARE, { angle, spacing: 10 })
      expect(marks.map((m) => m.kind)).toEqual(['lines'])
      const chains = marks[0].kind === 'lines' ? marks[0].chains : []
      expect(chains.length).toBeGreaterThan(10)
      for (const chain of chains) expect(Math.min(Math.abs(directionOf(chain) - angle), 180 - Math.abs(directionOf(chain) - angle))).toBeLessThan(1e-6)
      const offsets = [...new Set(chains.map((c) => Math.round(offsetOf(c, angle) * 1e6) / 1e6))].sort((a, b) => a - b)
      for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeCloseTo(10, 6)
    })
  }

  it('cross-hatch is two families, a quarter turn apart', () => {
    const marks = fill('crosshatch', SQUARE, { angle: 30 })
    const directions = new Set(marks.flatMap((m) => (m.kind === 'lines' ? m.chains.map((c) => Math.round(directionOf(c))) : [])))
    expect([...directions].sort((a, b) => a - b)).toEqual([30, 120])
  })

  it('spaces stipple dots by `spacing`', () => {
    const sparse = fill('stipple', SQUARE, { spacing: 20 })
    const dense = fill('stipple', SQUARE, { spacing: 10 })
    const count = (marks: FillMark[]) => (marks[0].kind === 'dots' ? marks[0].dots.length : 0)
    expect(count(dense) / count(sparse)).toBeGreaterThan(3)
    expect(count(dense) / count(sparse)).toBeLessThan(5)
  })
})

// The mark budget (review 1): a region may hold at most MARK_BUDGET of
// shading, whatever spacing is asked for; past it the spacing opens out.
describe('the mark budget', () => {
  const BIG: Chain[] = [polylineChain([{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 640, y: 640 }, { x: 0, y: 640 }, { x: 0, y: 0 }], true)]
  const length = (marks: FillMark[]) =>
    marks.reduce((sum, m) => sum + (m.kind === 'lines' ? m.chains.reduce((s, c) => s + c.pieces.reduce((t, p) => t + Math.hypot(pointOn(p, 1).x - pointOn(p, 0).x, pointOn(p, 1).y - pointOn(p, 0).y), 0), 0) : 0), 0)

  it('opens a hatch out to the budget, and no further', () => {
    for (const type of ['hatch', 'crosshatch', 'scribble'] as const) {
      const total = length(fill(type, BIG, { spacing: 3 }))
      expect(total, type).toBeLessThanOrEqual(MARK_BUDGET.length * 1.02)
      expect(total, type).toBeGreaterThan(MARK_BUDGET.length * 0.8)
    }
  })

  it('leaves a region inside the budget at its own spacing', () => {
    // 200 x 200 at spacing 10 is twenty lines, 4000 units: untouched.
    expect(length(fill('hatch', SQUARE, { spacing: 10, angle: 0 }))).toBeCloseTo(200 * 20, 6)
  })

  it('caps stipple dots', () => {
    const marks = fill('stipple', BIG, { spacing: 3 })
    const dots = marks[0].kind === 'dots' ? marks[0].dots.length : 0
    expect(dots).toBeLessThanOrEqual(MARK_BUDGET.dots * 1.1)
    expect(dots).toBeGreaterThan(MARK_BUDGET.dots * 0.7)
  })

  it('a rough scribble’s second pass still shares the budget, not a whole one of its own', () => {
    const total = length(fill('scribble', BIG, { spacing: 3, roughness: 1 }))
    expect(total).toBeLessThanOrEqual(MARK_BUDGET.length * 1.05)
  })

  // Review round 1: scribble's second pass used to jump straight in at
  // roughness 0.3 (no second pass at 0.3, a full third-of-the-budget one at
  // 0.31) rather than ramping. A jump would show up as one 0.01 step in
  // roughness changing the drawn length by close to a third of the budget;
  // ramping in over [0.3, 0.4] keeps every step small.
  it('scribble’s second pass fades in smoothly across roughness, not a jump at 0.3', () => {
    const at = (r: number) => length(fill('scribble', BIG, { spacing: 3, roughness: r }, 'ramp-seed'))
    const steps = [0.29, 0.3, 0.31, 0.32, 0.35, 0.38, 0.4, 0.41]
    for (let i = 1; i < steps.length; i++) {
      const delta = Math.abs(at(steps[i]) - at(steps[i - 1]))
      expect(delta, `${steps[i - 1]} -> ${steps[i]}`).toBeLessThan(MARK_BUDGET.length * 0.12)
    }
  })

  // Review round 1: rough hatch and crosshatch went over the budget by as
  // much as 17.5% at roughness 1 — bunching can shrink a step to 3/4 of the
  // spacing, and the end offsets overrun on top of that. A large region at a
  // fine spacing, across seeds and roughnesses, is what caught it.
  it('keeps rough hatch, crosshatch and scribble within the budget on a large region', () => {
    const HUGE: Chain[] = [polylineChain([{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 900 }, { x: 0, y: 900 }, { x: 0, y: 0 }], true)]
    for (const type of ['hatch', 'crosshatch', 'scribble'] as const) {
      for (const roughness of [0.1, 0.35, 0.45, 1]) {
        for (let seed = 0; seed < 8; seed++) {
          const total = length(fill(type, HUGE, { spacing: 3, roughness }, `budget-${type}-${roughness}-${seed}`))
          expect(total, `${type} r=${roughness} seed=${seed}`).toBeLessThanOrEqual(MARK_BUDGET.length * 1.02)
        }
      }
    }
  })
})

// Ben's first-look note: fills should be "a little less perfect" — roughness
// (2026-09-30 revision). At 0 none of this runs (the hash-pinned suite
// above is that proof); above 0 every fill strays on purpose.
describe('roughness', () => {
  it('hatch, crosshatch, scribble and stipple draw exactly their roughness-0 output when roughness is left out', () => {
    for (const type of ['hatch', 'crosshatch', 'scribble', 'stipple'] as const) {
      expect(fill(type, SQUARE, { roughness: 0 })).toEqual(fill(type, SQUARE, {}))
    }
  })

  it('hatch strays from its clean family once roughness rises', () => {
    const clean = fill('hatch', SQUARE, { roughness: 0, spacing: 6 })
    const rough = fill('hatch', SQUARE, { roughness: 1, spacing: 6 })
    expect(rough).not.toEqual(clean)
  })

  // Review round 1: the previous version of this test mixed end offsets,
  // angle and place together and still passed with both end offsets
  // deleted — angle and place alone can also push a point outside. At
  // angle 0 a clean stretch runs the full width (x from 0 to 200) and both
  // its ends share one y, so the end offsets (roughEnds, hatch.ts) are the
  // only thing that moves an end along x by a meaningful amount: turning a
  // stretch about its own midpoint (the angle jitter) barely shifts x when
  // its two ends already share a y before the turn.
  it('hatch’s ends move along the line once roughness rises — running past the true edge on one side, falling short of it on the other (rule 4)', () => {
    const rough = fill('hatch', SQUARE, { roughness: 1, spacing: 6, angle: 0 })
    const xs: number[] = []
    for (const mark of rough) if (mark.kind === 'lines') for (const chain of mark.chains) for (const piece of chain.pieces) if (piece.kind === 'line') xs.push(piece.from.x, piece.to.x)
    expect(xs.length).toBeGreaterThan(0)
    // The pen's clip is what keeps a run-past end from spilling out of the
    // region — the fill itself may draw past it.
    expect(xs.some((x) => x < -1e-6 || x > 200 + 1e-6), 'some end overruns the true edge').toBe(true)
    expect(xs.some((x) => x > 1 && x < 199), 'some end falls short of the true edge').toBe(true)
  })

  it('crosshatch’s second family strays from a quarter turn by more than one stretch’s own rotation can, once roughness rises', () => {
    // hatch.ts rotates each stretch about its own midpoint by at most 6° at
    // roughness 1 (a stretch belonging to either family). Any stretch
    // further than that from BOTH 30 and 120 can only be explained by
    // crosshatch's own extra draw, nudging the second family's angle by up
    // to 10° (crosshatch.ts) — the behaviour this test is for.
    let maxDeviation = 0
    for (let seed = 0; seed < 30; seed++) {
      const marks = FILLS.crosshatch.draw({ outline: SQUARE, settings: settingsFor('crosshatch', { angle: 30, roughness: 1 }), random: randomFor(`seed-${seed}`, 0) }).marks
      for (const m of marks) {
        if (m.kind !== 'lines') continue
        for (const c of m.chains) {
          const dir = directionOf(c)
          const devFrom30 = Math.min(Math.abs(dir - 30), 180 - Math.abs(dir - 30))
          const devFrom120 = Math.min(Math.abs(dir - 120), 180 - Math.abs(dir - 120))
          maxDeviation = Math.max(maxDeviation, Math.min(devFrom30, devFrom120))
        }
      }
    }
    expect(maxDeviation).toBeGreaterThan(6)
  })

  it('scribble turns leave their clean spots and round off, and a second pass thickens the fill past 0.3', () => {
    const clean = fill('scribble', SQUARE, { roughness: 0 })
    const rough = fill('scribble', SQUARE, { roughness: 0.6 })
    expect(rough).not.toEqual(clean)
    expect(rough[0].kind === 'lines' && rough[0].chains.some((c) => c.pieces.some((p) => p.kind === 'cubic'))).toBe(true)
    const lineCount = (marks: FillMark[]) => marks.reduce((n, m) => n + (m.kind === 'lines' ? m.chains.length : 0), 0)
    expect(lineCount(fill('scribble', SQUARE, { roughness: 0.6 }))).toBeGreaterThan(lineCount(fill('scribble', SQUARE, { roughness: 0.2 })))
  })

  it('stipple varies its size much more once roughness rises, every centre still inside the annulus’s hole', () => {
    const polygons = regionPolygons(ANNULUS)
    const rough = fill('stipple', ANNULUS, { roughness: 1 })
    const dots = rough[0].kind === 'dots' ? rough[0].dots : []
    expect(dots.length).toBeGreaterThan(0)
    for (const p of inkPoints(rough)) {
      const r = Math.hypot(p.x - 100, p.y - 100)
      expect(insideRegion(p, polygons) || Math.abs(r - 45) < 1e-6 || Math.abs(r - 90) < 1e-6).toBe(true)
    }
    // The base radius alone (0.1 to 0.18 of a spacing) never spreads more
    // than about 1.8x; roughness's own size multiplier (0.6x to 1.8x on top
    // of that) pushes it well past that on a big enough sample.
    const spread = (marks: FillMark[]) => {
      const radii = marks[0].kind === 'dots' ? marks[0].dots.map((d) => d.r) : []
      return Math.max(...radii) / Math.min(...radii)
    }
    expect(spread(rough)).toBeGreaterThan(3)
    expect(spread(rough)).toBeGreaterThan(spread(fill('stipple', ANNULUS, { roughness: 0 })))
  })

  // Review round 1, test gap: the size spread test above doesn't touch the
  // CLUMPING itself — a slow 2D density that thins dots into patches. A
  // coarse grid of cells over the region, counting dots per cell, is more
  // uneven (a higher standard deviation) at roughness 1 than at 0.
  it('stipple clumps into patches once roughness rises: dot counts vary much more across a coarse grid', () => {
    const GRID = 6
    const cellCounts = (marks: FillMark[]) => {
      const dots = marks[0].kind === 'dots' ? marks[0].dots : []
      const counts = new Array(GRID * GRID).fill(0)
      for (const dot of dots) {
        const cx = Math.min(GRID - 1, Math.max(0, Math.floor((dot.at.x / 200) * GRID)))
        const cy = Math.min(GRID - 1, Math.max(0, Math.floor((dot.at.y / 200) * GRID)))
        counts[cy * GRID + cx]++
      }
      return counts
    }
    const spread = (counts: number[]) => {
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length
      return Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length)
    }
    const clean = spread(cellCounts(fill('stipple', SQUARE, { roughness: 0, spacing: 3 })))
    const rough = spread(cellCounts(fill('stipple', SQUARE, { roughness: 1, spacing: 3 })))
    // Jitter and the occasional satellite dot (both tested above and below)
    // already spread the count out a little on their own — to about 1.7x
    // clean's spread, measured against the pre-fix code. Density clumping
    // is what pushes it much further than that, past 3x.
    expect(rough).toBeGreaterThan(clean * 3)
  })

  // Review round 1, test gap: a satellite dot, "with probability 0.05·r",
  // at 1 to 2 radii from its parent and 0.7 of its radius (stipple.ts).
  it('stipple adds a satellite dot beside some, now and then, once roughness rises', () => {
    const rough = fill('stipple', SQUARE, { roughness: 1, spacing: 10 })
    const dots = rough[0].kind === 'dots' ? rough[0].dots : []
    expect(dots.length).toBeGreaterThan(0)
    // Radius exactly 0.7 of its parent's (stipple.ts): a tight tolerance on
    // that ratio, so two regular dots near each other by chance don't read
    // as a satellite pair.
    const isSatelliteOf = (a: { at: Point; r: number }, b: { at: Point; r: number }) => {
      const d = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y)
      return d > 1e-6 && d <= 2.1 * b.r && Math.abs(a.r / b.r - 0.7) < 1e-6
    }
    let found = false
    for (const a of dots) {
      for (const b of dots) {
        if (a !== b && isSatelliteOf(a, b)) {
          found = true
          break
        }
      }
      if (found) break
    }
    expect(found).toBe(true)
  })

  it('flat is untouched at roughness 0, off register with a faint mottle above it', () => {
    expect(fill('flat', SQUARE, { roughness: 0 })).toEqual([{ kind: 'area' }])
    const rough = fill('flat', SQUARE, { roughness: 1 })
    expect(rough).toHaveLength(1)
    expect(rough[0]).toMatchObject({ kind: 'area', texture: 'mottle', strength: 1 })
    expect(rough[0].kind === 'area' && rough[0].shift).toBeDefined()
  })

  it('wash keeps its tint and rim off register together, above roughness 0', () => {
    const rough = fill('wash', SQUARE, { roughness: 1 })
    const area = rough.find((m) => m.kind === 'area')
    const edge = rough.find((m) => m.kind === 'edge')
    expect(area?.kind === 'area' ? area.shift : undefined).toBeDefined()
    expect(edge?.kind === 'edge' ? edge.shift : undefined).toEqual(area?.kind === 'area' ? area.shift : undefined)
    expect(fill('wash', SQUARE, { roughness: 0 })).toEqual([{ kind: 'area', texture: 'wash' }, expect.objectContaining({ kind: 'edge' })])
  })
})
