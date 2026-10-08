import type { TokenDef } from './types.js'
import { COLOUR_TOKENS } from './colour.js'

export * from './types.js'
export { createResolver, ResolveError } from './resolver.js'
export type { ModeSeeds, ResolverInput } from './resolver.js'

export const TOKENS: readonly TokenDef[] = [
  ...COLOUR_TOKENS,
]

export const tokenByName: ReadonlyMap<string, TokenDef> = (() => {
  const m = new Map<string, TokenDef>()
  for (const t of TOKENS) {
    if (m.has(t.name)) throw new Error(`duplicate token name: ${t.name}`)
    m.set(t.name, t)
  }
  return m
})()
