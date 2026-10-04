// The paint session: everything the painter does on the CPU between the
// renderer's G-buffer readback and the renderer's paint, kept in one place so it
// can run on the page's own thread or in a Web Worker without the page knowing
// which (the Paint Lab's worker is a thin message wrapper around this).
//
// A session holds, per scene it has been given, the particles (built when first
// needed, and again when the seed, the packing or the colours change), the paper
// (generated once per weave and seed, recoloured when the tone or the texture
// changes), and the last full frame's strokes with their colour recipes, so that
// a change of colour parameters alone (model/index.ts isColourOnlyChange) is a
// recolour: the colours and the brush-load mix again, with no analysis.
//
// A frame request is either
//   full    the G-buffer from the renderer, the whole model; or
//   colour  no G-buffer: the colours of the last full frame, made again under the
//           new parameters. If the session has no frame to recolour (a different
//           scene, or the parameters changed more than colour), it answers
//           `needFull` and the caller sends a full request.
//   paper   only the paper, for a frame the caller paints again itself (a change of
//           the relief or the canvas's texture or weave moves no stroke).
//
// With the key light fixed in the world the session also makes the BAKED painting (bake/index.ts), once for a scene and its params, and keeps
// it (with the recipes it was made from, which stay here: the page gets the arrays and never the recipes):
//   bake      the particles (built when needed), then bakePaintingWithProgress, with its progress reported as a percentage;
//   recolour  the bake's colours again under colour-only params (recolourBake): only the colour arrays go back, the page swaps them in.
// It holds ONE bake (the newest, whichever scene), and a request for a bake it does not hold (another key, another scene, or params that
// are more than colour) is answered `needBake`.
//
// Scenes are handed over as plain data (`plainScene`: the pick and drag closures
// of a scene cannot cross to a worker and the painter never uses them), and the
// scene's colours as the table of every mark's colour plus a 256-entry table for
// each colour scale (`colourDataOf`), which is what the colour scale is anyway.

import { normalise, TABLE_SIZE } from '../colormaps'
import type { Mark, Range, SpaceScene } from '../scene/types'
import { colourisePaper, generatePaper } from '../../style/papers/generate/index'
import { bakePaintingWithProgress, classifyBakeChange, recolourBake, type BakeProgress } from './bake/index'
import type { AuthoredFraming, BakedPainting, BakedSurface } from './bake/types'
import { buildParticles, classifyChange, paintFrame, recolourFrame } from './model/index'
import { paperTileSize, resampleTile } from './paperScale'
import type { PaintParams } from './params'
import type { GBuffer, Oklab, PaintDebugMode, PaintFrame, PaintView, ParticleSet, SceneColours, StrokeBatch } from './types'


// ---- what crosses to a worker ----

// The scene without its closures.
export function plainScene(scene: SpaceScene): SpaceScene {
  const marks = scene.marks.map((mark): Mark => {
    switch (mark.kind) {
      case 'mesh':
        return { ...mark, pick: null }
      case 'lines':
        return { ...mark, pick: null }
      case 'points': {
        const { drag: _drag, ...rest } = mark
        return rest
      }
      default:
        return mark
    }
  })
  return { ...scene, marks, labels: [], errors: [] }
}

export interface ScaleColourData {
  domain: Range
  diverging: boolean
  // Entry i is the colour at position i/255 of the scale's map.
  table: Oklab[]
  noData: Oklab
}

export interface SceneColourData {
  // The flat colour of each mark (OKLab).
  marks: Oklab[]
  scales: ScaleColourData[]
}

// The colour table of each colour scale: sample the colours at the value that
// lands on each of the map's 256 entries (a colour scale IS a 256-entry table:
// colorOf rounds a value's position to one), so the sampled tables answer
// exactly as the colours do.
export function colourDataOf(scene: SpaceScene, colours: SceneColours): SceneColourData {
  const marks = scene.marks.map((_, i): Oklab => {
    const c = colours.markColour(i)
    return [c[0], c[1], c[2]]
  })
  const scales = scene.colorScales.map((scale, id): ScaleColourData => {
    const { min, max } = scale.domain
    const m = Math.max(Math.abs(min), Math.abs(max), 1e-30)
    const table: Oklab[] = []
    for (let i = 0; i < TABLE_SIZE; i++) {
      const t = i / (TABLE_SIZE - 1)
      // the value whose position on the scale is t (normalise() inverted)
      const v = scale.diverging ? (t - 0.5) * 2 * m : min + t * Math.max(max - min, 1e-30)
      const c = colours.scaleColour(id, v) ?? [0, 0, 0]
      table.push([c[0], c[1], c[2]])
    }
    const none = colours.scaleColour(id, Number.NaN) ?? [0, 0, 0]
    return { domain: { min, max }, diverging: scale.diverging, table, noData: [none[0], none[1], none[2]] }
  })
  return { marks, scales }
}

export function coloursFromData(data: SceneColourData): SceneColours {
  return {
    markColour: (i) => data.marks[i] ?? [0.6, 0, 0],
    scaleColour: (id, v) => {
      const scale = data.scales[id]
      if (!scale) return null
      const t = normalise(v, scale)
      return t === null ? scale.noData : scale.table[Math.round(t * (TABLE_SIZE - 1))]
    },
  }
}

// ---- requests and responses ----

export interface PaperWanted {
  weave: 'duck' | 'linen'
  seed: number
  tone: [number, number, number]
  texture: number
  // Device px to the CSS px of the view: the tile is made at 512 x ratio texels, two to the CSS px at any ratio
  // (paperScale.ts), so the weave is the mockup's size on any display.
  ratio: number
}

export const paperKey = (p: PaperWanted): string => `${p.weave}|${p.seed}|${p.tone.join(',')}|${p.texture}|${paperTileSize(p.ratio)}`

export interface PaperData {
  key: string
  rgba: Uint8ClampedArray
  height: Float32Array
  size: number
}

export interface SessionRequest {
  id: number
  sceneId: number
  kind: 'full' | 'colour' | 'paper'
  params: PaintParams
  view: PaintView
  // Full requests only; the session keeps nothing of it past the frame.
  gbuffer: GBuffer | null
  // Which of the model's per-pixel debug views to send back (the others are not built).
  debug: PaintDebugMode
  // The paper the page holds now (its key); the response carries the paper when this is not the one wanted.
  havePaper: string
  paper: PaperWanted
}

// What of a frame crosses back: the strokes, the debug arrays the view in use reads, the stats.
export interface WireDebug {
  value: Float32Array | null
  zones: Uint8Array | null
  planes: Int32Array | null
  edgeSegments: Float32Array
  edgeClass: Uint8Array
}

export interface SessionTiming {
  // The model's frame, the particles it had to build first, and the paper.
  modelMs: number
  particlesMs: number
  paperMs: number
}

export interface FrameResponse {
  id: number
  ok: true
  kind: 'full' | 'colour'
  strokes: StrokeBatch
  // The underpainting (PaintFrame.underpaint): a colour frame has its colours made again too.
  underpaint: Float32Array
  // Null for a colour frame: the debug views are the last full frame's.
  debug: WireDebug | null
  stats: PaintFrame['stats']
  paper: PaperData | null
  timing: SessionTiming
}

// A paper request's answer: the paper, and nothing of a frame.
export interface PaperResponse {
  id: number
  ok: true
  kind: 'paper'
  paper: PaperData | null
  timing: SessionTiming
}

export type SessionResponse =
  | FrameResponse
  | PaperResponse
  | { id: number; ok: false; needFull: true }
  | { id: number; ok: false; error: string }

// ---- the baked painting ----

export interface BakeRequest {
  id: number
  sceneId: number
  params: PaintParams
  // The key light's direction in the world (a light fixed in the world: view.lightDir), and the framing the picture is composed for.
  lightDir: [number, number, number]
  authored: AuthoredFraming
}

// The bake, as it crosses to the page. `bakeMs` is the bake alone, `particlesMs` the particles it had to build first (0 when the session
// held them).
export interface BakeResponse {
  id: number
  ok: true
  kind: 'bake'
  baked: BakedPainting
  bakeMs: number
  particlesMs: number
}

export interface RecolourRequest {
  id: number
  sceneId: number
  // The key of the bake the page holds (BakedPainting.key): the colours are made again only of that one.
  key: string
  params: PaintParams
}

// What a recolour changes of a baked painting: its stroke colours at every brush-load level, the colour of each data mark's strokes, and
// each surface's underpainting (both sides). Every other array of the painting is the one the page holds already (recolourBake shares
// them by identity), and so are the alphas (they are not colours).
export interface BakedColours {
  colour: Float32Array
  dataColour: Float32Array
  surfaces: ({ underFront: Float32Array; underBack: Float32Array | null } | null)[]
}

export interface RecolourResponse {
  id: number
  ok: true
  kind: 'recolour'
  colours: BakedColours
  ms: number
}

export type BakeAnswer = BakeResponse | { id: number; ok: false; needBake: true } | { id: number; ok: false; error: string }
export type RecolourAnswer = RecolourResponse | { id: number; ok: false; needBake: true } | { id: number; ok: false; error: string }

// The share of a bake's time each phase takes (measured on the lab's figures, task-3b-report.md: the plan 37%, the planes 10%, the edges 8%, the
// strokes 32%, the underpainting 6%, the packing and colours 6% to 7%), for the percentage of its progress.
const PHASE_SHARE: Record<BakeProgress['phase'], [from: number, share: number]> = {
  plan: [0, 0.38],
  planes: [0.38, 0.1],
  edges: [0.48, 0.08],
  strokes: [0.56, 0.32],
  underpaint: [0.88, 0.06],
  pack: [0.94, 0.06],
}

// A bake's progress as a whole percent, 0 to 100.
export const bakePercent = (p: BakeProgress): number => {
  const [from, share] = PHASE_SHARE[p.phase]
  return Math.max(0, Math.min(100, Math.floor(100 * (from + share * Math.max(0, Math.min(1, p.done))))))
}

// The arrays of a surface that the session keeps using after the bake went (they are the recipes' own: bake/underpaint.ts SurfaceUnder shares
// them with the baked surface): cloned when a bake is handed over, not transferred.
const KEPT_BY_SESSION: ReadonlySet<string> = new Set(['positions', 'local', 'uFront', 'uBack', 'famFront', 'famBack', 'alphaFront', 'alphaBack'])

// The ArrayBuffers of a bake that may be handed over rather than copied: every typed array of the painting and of its surfaces but the ones the
// session's recipes share with it (the session recolours the bake later, and a transferred array is gone from this side).
export function bakeTransferList(baked: BakedPainting): ArrayBuffer[] {
  const out: ArrayBuffer[] = []
  const seen = new Set<ArrayBuffer>()
  const add = (v: unknown): void => {
    if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer && !seen.has(v.buffer)) {
      seen.add(v.buffer)
      out.push(v.buffer)
    }
  }
  const kept = new Set<ArrayBuffer>()
  for (const s of baked.surfaces) {
    if (!s) continue
    for (const [k, v] of Object.entries(s)) if (KEPT_BY_SESSION.has(k) && ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) kept.add(v.buffer)
  }
  for (const v of Object.values(baked)) add(v)
  for (const s of baked.surfaces) {
    if (!s) continue
    for (const [k, v] of Object.entries(s)) if (!KEPT_BY_SESSION.has(k)) add(v)
  }
  return out.filter((b) => !kept.has(b))
}

export function recolourTransferList(c: BakedColours): ArrayBuffer[] {
  const out: ArrayBuffer[] = []
  const add = (a: ArrayBufferView | null) => {
    if (a && a.buffer instanceof ArrayBuffer && !out.includes(a.buffer)) out.push(a.buffer)
  }
  add(c.colour)
  add(c.dataColour)
  for (const s of c.surfaces) {
    if (!s) continue
    add(s.underFront)
    add(s.underBack)
  }
  return out
}

// The colour arrays of a recoloured painting, to send back.
export function coloursOfBake(b: BakedPainting): BakedColours {
  return {
    colour: b.colour,
    dataColour: b.dataColour,
    surfaces: b.surfaces.map((s) => (s ? { underFront: s.underFront, underBack: s.underBack } : null)),
  }
}

// The painting the page holds with new colours swapped in (a new object; every other array is the one it had, so everything keyed to them stays).
export function withColours(baked: BakedPainting, c: BakedColours): BakedPainting {
  const surfaces = baked.surfaces.map((s, m): BakedSurface | null => {
    const u = c.surfaces[m]
    return s && u ? { ...s, underFront: u.underFront, underBack: u.underBack } : s
  })
  return { ...baked, colour: c.colour, dataColour: c.dataColour, surfaces }
}

// The ArrayBuffers of a response that may be handed over rather than copied. (The
// paper's height is the generator's cached tile: it is copied.)
export function transferList(res: SessionResponse): ArrayBuffer[] {
  if (!res.ok) return []
  if (res.kind === 'paper') return res.paper ? [res.paper.rgba.buffer as ArrayBuffer] : []
  const out: ArrayBuffer[] = []
  const add = (a: ArrayBufferView | null) => {
    if (a && a.buffer instanceof ArrayBuffer) out.push(a.buffer)
  }
  const s = res.strokes
  for (const a of [s.role, s.layer, s.path, s.width, s.depth, s.colour, s.alpha, s.load, s.impasto, s.bristles, s.bristleVar, s.dry, s.wet, s.endSoft, s.edge, s.seed]) add(a)
  add(res.underpaint)
  if (res.debug) for (const a of [res.debug.value, res.debug.zones, res.debug.planes, res.debug.edgeSegments, res.debug.edgeClass]) add(a)
  if (res.paper) add(res.paper.rgba)
  return out
}

// ---- the paper ----

const WEAVE_TYPE = { duck: 'canvas', linen: 'linen' } as const
const PAPER_SIZE = 1024

// ---- the session ----

interface SceneEntry {
  scene: SpaceScene
  colours: SceneColours
  // Bumped when the colours change, so the particles are built again.
  colourVersion: number
  particles: { set: ParticleSet; key: string; colourVersion: number } | null
}

// What buildParticles reads from the params: the seed, the packing, and the
// size of a brush-load cell.
export const particleKey = (p: PaintParams): string => `${p.seed}|${p.particles.maxPerUnit2}|${p.mix.loadCell}`

export class PaintSession {
  private readonly scenes = new Map<number, SceneEntry>()
  // The last full frame: what a colour request recolours.
  private analysis: { sceneId: number; params: PaintParams; frame: PaintFrame; debug: PaintDebugMode } | null = null
  // The newest baked painting (one: it is tens of MB with its recipes), and the params its colours were last made for.
  private baked: { sceneId: number; baked: BakedPainting; params: PaintParams } | null = null
  // A scene (plain, see plainScene) and its colours. The same id again replaces both.
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData): void {
    const have = this.scenes.get(sceneId)
    this.scenes.set(sceneId, { scene, colours: coloursFromData(colours), colourVersion: (have?.colourVersion ?? 0) + 1, particles: null })
    if (this.analysis?.sceneId === sceneId) this.analysis = null
    if (this.baked?.sceneId === sceneId) this.baked = null
  }

  // New colours for a scene it holds (a theme, a local colour): the particles are built again, the scene is not sent again.
  setColours(sceneId: number, colours: SceneColourData): void {
    const entry = this.scenes.get(sceneId)
    if (!entry) return
    entry.colours = coloursFromData(colours)
    entry.colourVersion++
    if (this.analysis?.sceneId === sceneId) this.analysis = null
    // (a bake is made of the colours it was given: another set is another bake)
    if (this.baked?.sceneId === sceneId) this.baked = null
  }

  forget(sceneId: number): void {
    this.scenes.delete(sceneId)
    if (this.analysis?.sceneId === sceneId) this.analysis = null
    if (this.baked?.sceneId === sceneId) this.baked = null
  }

  hasScene(sceneId: number): boolean {
    return this.scenes.has(sceneId)
  }

  // Can a colour request for these params recolour what the session holds? (Colour parameters, and
  // renderer ones, which move no stroke; anything else needs the analysis again.)
  canRecolour(sceneId: number, params: PaintParams, debug: PaintDebugMode): boolean {
    const a = this.analysis
    return a !== null && a.sceneId === sceneId && a.debug === debug && classifyChange(a.params, params) !== 'full'
  }

  frame(req: SessionRequest): SessionResponse {
    try {
      const entry = this.scenes.get(req.sceneId)
      if (!entry) return { id: req.id, ok: false, error: `paint session: scene ${req.sceneId} was never set` }
      let paperMs = 0
      let paper: PaperData | null = null
      const wanted = paperKey(req.paper)
      if (wanted !== req.havePaper) {
        const t0 = performance.now()
        paper = this.makePaper(req.paper, wanted)
        paperMs = performance.now() - t0
      }

      if (req.kind === 'paper') return { id: req.id, ok: true, kind: 'paper', paper, timing: { modelMs: 0, particlesMs: 0, paperMs } }

      if (req.kind === 'colour') {
        if (!this.canRecolour(req.sceneId, req.params, req.debug)) return { id: req.id, ok: false, needFull: true }
        const t0 = performance.now()
        const frame = recolourFrame((this.analysis as { frame: PaintFrame }).frame, req.params)
        if (!frame) {
          this.analysis = null
          return { id: req.id, ok: false, needFull: true }
        }
        return { id: req.id, ok: true, kind: 'colour', strokes: frame.strokes, underpaint: frame.underpaint, debug: null, stats: frame.stats, paper, timing: { modelMs: performance.now() - t0, particlesMs: 0, paperMs } }
      }

      if (!req.gbuffer) return { id: req.id, ok: false, error: 'paint session: a full frame needs the G-buffer' }
      const { set, ms: particlesMs } = this.particlesFor(entry, req.params)
      const t1 = performance.now()
      const frame = paintFrame(entry.scene, set, req.view, req.gbuffer, req.params)
      const modelMs = performance.now() - t1
      this.analysis = { sceneId: req.sceneId, params: req.params, frame, debug: req.debug }
      return { id: req.id, ok: true, kind: 'full', strokes: frame.strokes, underpaint: frame.underpaint, debug: wireDebug(frame, req.debug), stats: frame.stats, paper, timing: { modelMs, particlesMs, paperMs } }
    } catch (error) {
      return { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // The particles of a scene for these params, built when it has none or they are not these params' (the seed, the packing, the load cell) or
  // the colours changed; `ms` is what building them took (0 when held).
  private particlesFor(entry: SceneEntry, params: PaintParams): { set: ParticleSet; ms: number } {
    const key = particleKey(params)
    const held = entry.particles
    if (held && held.key === key && held.colourVersion === entry.colourVersion) return { set: held.set, ms: 0 }
    const t0 = performance.now()
    const made = { set: buildParticles(entry.scene, entry.colours, params), key, colourVersion: entry.colourVersion }
    entry.particles = made
    return { set: made.set, ms: performance.now() - t0 }
  }

  // The baked painting for a scene, the light fixed in the world, and the params (bake/index.ts). `progress` is told the whole percent as it
  // grows (0 to 100, each value once). Never throws: a failure is answered as an error. The painting is kept here, with its recipes, for `recolour`.
  bake(req: BakeRequest, progress?: (percent: number) => void): BakeAnswer {
    try {
      const entry = this.scenes.get(req.sceneId)
      if (!entry) return { id: req.id, ok: false, error: `paint session: scene ${req.sceneId} was never set` }
      const { set, ms: particlesMs } = this.particlesFor(entry, req.params)
      let told = -1
      const report = (p: BakeProgress): void => {
        const percent = bakePercent(p)
        if (percent !== told) progress?.((told = percent))
      }
      // (a bake the session holds is let go first: two are tens of MB twice)
      this.baked = null
      const t0 = performance.now()
      const baked = bakePaintingWithProgress(entry.scene, set, entry.colours, req.lightDir, req.params, req.authored, report)
      const bakeMs = performance.now() - t0
      this.baked = { sceneId: req.sceneId, baked, params: req.params }
      return { id: req.id, ok: true, kind: 'bake', baked, bakeMs, particlesMs }
    } catch (error) {
      return { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // The colours of the bake the session holds, made again under colour-only params. `needBake` when it holds another bake (another key or scene)
  // or the params moved more than colour.
  recolour(req: RecolourRequest): RecolourAnswer {
    try {
      const held = this.baked
      if (!held || held.sceneId !== req.sceneId || held.baked.key !== req.key || classifyBakeChange(held.params, req.params) === 'bake') return { id: req.id, ok: false, needBake: true }
      const t0 = performance.now()
      const next = recolourBake(held.baked, req.params)
      if (!next) return { id: req.id, ok: false, needBake: true }
      this.baked = { sceneId: req.sceneId, baked: next, params: req.params }
      return { id: req.id, ok: true, kind: 'recolour', colours: coloursOfBake(next), ms: performance.now() - t0 }
    } catch (error) {
      return { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // The paper tile: the weave's own colour (the tone, and the cloth's brightness and mottle) and its height,
  // and no lighting of the weave. The renderer lights the weave itself, once, with the relief light it lights the
  // paint with (the way the mockup does); a tile colourised with its own grazing light as well, as the paper
  // module's own pictures are, was lit twice and read as burlap. The structure is the generator's cached one
  // (a texture is a scale of it), so a change of texture or tone is a cheap pass; the tile is then made the size
  // the view needs (paperScale.ts).
  private makePaper(want: PaperWanted, key: string): PaperData {
    const tile = generatePaper(WEAVE_TYPE[want.weave], { texture: want.texture, seed: String(want.seed), size: PAPER_SIZE })
    const flat = colourisePaper(tile, want.tone, 0)
    const sized = resampleTile(flat, tile.height, tile.size, paperTileSize(want.ratio))
    return { key, rgba: sized.rgba, height: sized.height, size: sized.size }
  }
}

// The per-pixel debug arrays the view in use reads, built from the lazy getters; the others are left out.
function wireDebug(frame: PaintFrame, mode: PaintDebugMode): WireDebug {
  const d = frame.debug
  return {
    value: mode === 'value' ? d.value : null,
    zones: mode === 'zones' ? d.zones : null,
    planes: mode === 'planes' || mode === 'edges' ? d.planes : null,
    edgeSegments: d.edgeSegments,
    edgeClass: d.edgeClass,
  }
}
