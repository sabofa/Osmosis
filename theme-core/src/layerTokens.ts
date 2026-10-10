/**
 * Layer transparency tokens: the single source of defaults and floors (06-engine-host 2.2/2.3/2.8).
 * Leaf module: it must not import from ./registry or ./resolve (the registry reads from here).
 */
export interface LayerTokenDef {
  token: string
  label: string
  default: number
  floor: number
  /** Per paper kind floor (graph paper boards stay nearly opaque). */
  floorsBy?: Record<string, number>
  /** Another layer token this one may never be less opaque than (06 2.8). */
  atLeast?: string
  /** The translucency dial moves this token's default toward its floor. */
  dialDriven: boolean
}

export const LAYER_TOKENS: readonly LayerTokenDef[] = [
  { token: 'doc-sheet-alpha', label: 'Document sheet', default: 1, floor: 0.55, dialDriven: true },
  { token: 'doc-surface-alpha', label: 'Document surfaces', default: 0.9, floor: 0.6, dialDriven: true },
  { token: 'doc-media-alpha', label: 'Pictures and PDFs', default: 0.95, floor: 0.7, atLeast: 'doc-sheet-alpha', dialDriven: true },
  {
    token: 'graph-paper-alpha', label: 'Graph paper', default: 1, floor: 0.25, dialDriven: true,
    floorsBy: { blackboard: 0.85, greenboard: 0.85, whiteboard: 0.85 },
  },
  { token: 'graph-grid-alpha', label: 'Grid', default: 1, floor: 0.15, dialDriven: true },
  { token: 'graph-region-alpha', label: 'Region fills', default: 0.18, floor: 0.05, dialDriven: false },
  { token: 'callout-alpha', label: 'Callouts', default: 0.92, floor: 0.7, dialDriven: true },
]

export interface FloorCtx { paper?: string; minOverride?: number }

const BY_TOKEN: ReadonlyMap<string, LayerTokenDef> = new Map(LAYER_TOKENS.map((t) => [t.token, t]))

function layerDef(token: string): LayerTokenDef {
  const d = BY_TOKEN.get(token)
  if (!d) throw new Error(`unknown layer token: ${token}`)
  return d
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000

export function effectiveFloor(token: string, ctx: FloorCtx = {}): number {
  const d = layerDef(token)
  const byPaper = ctx.paper !== undefined && d.floorsBy ? (d.floorsBy[ctx.paper] ?? 0) : 0
  const over = typeof ctx.minOverride === 'number' && Number.isFinite(ctx.minOverride) ? ctx.minOverride : 0
  return Math.min(1, Math.max(d.floor, byPaper, over))
}

export function clampTokenValue(token: string, value: number | string, ctx: FloorCtx = {}): number {
  const d = layerDef(token)
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  const floor = effectiveFloor(token, ctx)
  const v = Number.isFinite(n) ? n : d.default
  return Math.min(1, Math.max(floor, v))
}

export function formatAlpha(n: number): string {
  return String(round3(n))
}

export function dialDefault(token: string, translucency: number): number {
  const d = layerDef(token)
  if (!d.dialDriven) return d.default
  const t = Math.min(1, Math.max(0, Number.isFinite(translucency) ? translucency : 0))
  return round3(d.default + (d.floor - d.default) * t)
}

export function assertNoCycles(defs: readonly LayerTokenDef[]): void {
  const by = new Map(defs.map((d) => [d.token, d]))
  for (const start of defs) {
    const path = [start.token]
    let cur = start.atLeast
    while (cur !== undefined) {
      if (path.includes(cur)) throw new Error(`layer token cycle: ${[...path, cur].join(' -> ')}`)
      path.push(cur)
      cur = by.get(cur)?.atLeast
    }
  }
}

assertNoCycles(LAYER_TOKENS)

export function resolveLayerAlphas(
  themeValues: Partial<Record<string, number | string>>,
  deviceOverrides: Partial<Record<string, number | string>> = {},
  ctx: FloorCtx = {},
): Record<string, number> {
  const out: Record<string, number> = {}
  const resolveOne = (token: string): number => {
    const hit = out[token]
    if (hit !== undefined) return hit
    const d = layerDef(token)
    const raw = deviceOverrides[token] ?? themeValues[token] ?? d.default
    let v = clampTokenValue(token, raw, ctx)
    if (d.atLeast) v = Math.max(v, resolveOne(d.atLeast))
    out[token] = v
    return v
  }
  for (const d of LAYER_TOKENS) resolveOne(d.token)
  return out
}
