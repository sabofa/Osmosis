// The shared paper generator (spec 2026-10-02-painted-figures-design.md §5):
// seeded, tileable paper tiles built as STRUCTURE (OKLab offsets plus height),
// recoloured by `colourisePaper`. M1 shipped primed cotton duck ('canvas') and fine primed linen; the
// grain papers (fine, rough, kraft, notebook, graph, dotted) and the three boards (blackboard,
// greenboard, whiteboard) are structures of the same kind (structures/), and the figures' backgrounds
// (papers/generated.ts) are made of them.
//
// Generating a 1024^2 tile costs a few hundred milliseconds, so it is cached by
// (type, texture, seed, size). The expensive part is the structure, which does
// not depend on `texture`; it is cached by (type, seed, size) and a texture is
// applied as a cheap scale, so dragging a texture slider never regenerates a
// weave. The arrays of a returned tile are shared with the cache: read them,
// never write them.

import { buildCanvas } from './canvas'
import { colourisePaper } from './colourise'
import { buildLinen } from './linen'
import { buildBlackboard } from './structures/blackboard'
import { buildDotted } from './structures/dotted'
import { buildGraphPaper } from './structures/graphPaper'
import { buildGreenboard } from './structures/greenboard'
import { buildKraft } from './structures/kraft'
import { buildNotebook } from './structures/notebook'
import { buildPaperFine } from './structures/paperFine'
import { buildPaperRough } from './structures/paperRough'
import { buildWhiteboard } from './structures/whiteboard'
import { softLimit } from './structure'
import type { Structure } from './structure'
import type { GeneratedPaperType, GeneratePaper, PaperTile } from './types'

export { colourisePaper }

const DEFAULT_SIZE = 1024
const MIN_SIZE = 16
const MAX_SIZE = 4096
const MAX_TEXTURE = 2

// A 1024^2 structure is 16 MB and a tile of its own texture 16 MB more, so the
// caches stay small: the weave in use and a couple of texture variants.
const MAX_STRUCTURES = 2
const MAX_TILES = 3

const BUILDERS: Record<GeneratedPaperType, (size: number, seed: string) => Structure> = {
  canvas: buildCanvas,
  linen: buildLinen,
  paperFine: buildPaperFine,
  paperRough: buildPaperRough,
  kraft: buildKraft,
  notebook: buildNotebook,
  graphPaper: buildGraphPaper,
  dotted: buildDotted,
  blackboard: buildBlackboard,
  greenboard: buildGreenboard,
  whiteboard: buildWhiteboard,
}

// Every type the generator builds.
export const GENERATED_PAPER_TYPES = Object.keys(BUILDERS) as GeneratedPaperType[]

const structures = new Map<string, Structure>()
const tiles = new Map<string, PaperTile>()

// Least-recently-used get and put on an insertion-ordered Map.
function recall<V>(cache: Map<string, V>, key: string): V | undefined {
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}
function remember<V>(cache: Map<string, V>, key: string, value: V, max: number): V {
  cache.set(key, value)
  while (cache.size > max) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return value
}

// A tile at `texture` from a structure at texture 1: offsets scale linearly,
// height deviates from the 0.5 mean linearly (and is softly limited to 0..1).
function applyTexture(type: GeneratedPaperType, structure: Structure, texture: number): PaperTile {
  const { size, offsets, deviation } = structure
  if (texture === 1) {
    const height = new Float32Array(deviation.length)
    for (let i = 0; i < height.length; i++) height[i] = 0.5 + softLimit(deviation[i])
    return { type, size, offsets, height }
  }
  if (texture === 0) {
    return { type, size, offsets: new Float32Array(offsets.length), height: new Float32Array(deviation.length).fill(0.5) }
  }
  const scaled = new Float32Array(offsets.length)
  for (let i = 0; i < scaled.length; i++) scaled[i] = offsets[i] * texture
  const height = new Float32Array(deviation.length)
  for (let i = 0; i < height.length; i++) height[i] = 0.5 + softLimit(texture * deviation[i])
  return { type, size, offsets: scaled, height }
}

export const generatePaper: GeneratePaper = (type, settings) => {
  const build = Object.hasOwn(BUILDERS, type) ? BUILDERS[type] : undefined
  if (!build) throw new RangeError(`unknown generated paper type: ${String(type)}`)
  const size = settings.size ?? DEFAULT_SIZE
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new RangeError(`paper size must be a whole number of texels from ${MIN_SIZE} to ${MAX_SIZE}, got ${size}`)
  }
  const texture = Number.isFinite(settings.texture) ? Math.min(MAX_TEXTURE, Math.max(0, settings.texture)) : 1
  const seed = settings.seed

  const tileKey = `${type}|${texture}|${seed}|${size}`
  const cached = recall(tiles, tileKey)
  if (cached) return cached

  const structureKey = `${type}|${seed}|${size}`
  const structure = recall(structures, structureKey) ?? remember(structures, structureKey, build(size, seed), MAX_STRUCTURES)
  return remember(tiles, tileKey, applyTexture(type, structure, texture), MAX_TILES)
}

// Drops every cached tile and structure (tests, and a theme or memory reset).
export function clearPaperCache(): void {
  structures.clear()
  tiles.clear()
}
