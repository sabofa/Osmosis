import type { Oklch } from '../colour.js'
import { parseColour } from '../colour.js'
import type { Dials, FontRef, FontRole, Mode } from '../manifest.js'
import { parseTokenValue, type DeriveCtx, type SeedKey, type TokenDef } from './types.js'

export interface ModeSeeds {
  canvas: Oklch; ink: Oklch; accent: Oklch
  surface?: Oklch; secondary?: Oklch; good?: Oklch; bad?: Oklch; warn?: Oklch; info?: Oklch
  series?: Oklch[]
}

export interface ResolverInput {
  mode: Mode
  defs: readonly TokenDef[]
  seeds: ModeSeeds
  dials: Dials
  fonts: Record<FontRole, FontRef>
  /** already merged for this mode; keys are token names without '--' */
  overrides?: Record<string, string>
}

export class ResolveError extends Error {
  token: string
  constructor(token: string, message: string) {
    super(message)
    this.name = 'ResolveError'
    this.token = token
  }
}

export function createResolver(i: ResolverInput): {
  get(name: string): string
  all(): Record<string, string>
  overridden: ReadonlySet<string>
} {
  const byName = new Map<string, TokenDef>()
  for (const d of i.defs) byName.set(d.name, d)
  const overrides = i.overrides ?? {}
  const overridden = new Set<string>()
  for (const [name, v] of Object.entries(overrides)) {
    const d = byName.get(name)
    if (!d) throw new ResolveError(name, `override names unknown token "${name}"`)
    if (!parseTokenValue(d.type, v)) {
      throw new ResolveError(name, `override for "${name}" is not a valid ${d.type}: ${JSON.stringify(v)}`)
    }
    overridden.add(name)
  }

  const memo = new Map<string, string>()
  const stack: string[] = []

  const ctx: DeriveCtx = {
    mode: i.mode,
    dials: i.dials,
    fonts: i.fonts,
    hasSeed: (k: SeedKey) => i.seeds[k] !== undefined,
    seed(k: SeedKey): Oklch {
      const s = i.seeds[k]
      if (!s) throw new ResolveError(k, `seed "${k}" is not set`)
      return s
    },
    seriesSeed: (n: number) => i.seeds.series?.[n] ?? null,
    get: (name: string) => get(name),
    col: (name: string) => parseColour(get(name)),
  }

  function get(name: string): string {
    const hit = memo.get(name)
    if (hit !== undefined) return hit
    const d = byName.get(name)
    if (!d) throw new ResolveError(name, `unknown token "${name}"`)
    if (stack.includes(name)) {
      throw new ResolveError(name, `dependency cycle: ${[...stack, name].join(' -> ')}`)
    }
    let v: string
    if (overridden.has(name)) v = overrides[name]!
    else {
      stack.push(name)
      try { v = d.derive(ctx) } finally { stack.pop() }
    }
    memo.set(name, v)
    return v
  }

  return {
    get,
    all() {
      const out: Record<string, string> = {}
      for (const d of i.defs) out[d.name] = get(d.name)
      return out
    },
    overridden,
  }
}
