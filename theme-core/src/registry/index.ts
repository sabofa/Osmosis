import type { TokenDef } from './types.js'
import { COLOUR_TOKENS } from './colour.js'
import { DOC_TOKENS, GRAPH_TOKENS } from './engines.js'
import { ELEVATION_TOKENS, MOTION_TOKENS, SHAPE_TOKENS, SPACE_TOKENS, SURFACE_TOKENS, TYPE_TOKENS } from './layout.js'

export * from './types.js'
export { createResolver, ResolveError } from './resolver.js'
export type { ModeSeeds, ResolverInput } from './resolver.js'

export const TOKENS: readonly TokenDef[] = [
  ...COLOUR_TOKENS,
  ...TYPE_TOKENS,
  ...SHAPE_TOKENS,
  ...SPACE_TOKENS,
  ...ELEVATION_TOKENS,
  ...MOTION_TOKENS,
  ...SURFACE_TOKENS,
  ...GRAPH_TOKENS,
  ...DOC_TOKENS,
]

export const tokenByName: ReadonlyMap<string, TokenDef> = (() => {
  const m = new Map<string, TokenDef>()
  for (const t of TOKENS) {
    if (m.has(t.name)) throw new Error(`duplicate token name: ${t.name}`)
    m.set(t.name, t)
  }
  return m
})()
