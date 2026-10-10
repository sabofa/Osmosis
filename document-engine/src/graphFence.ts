import { parseBlocks, type MdBlock } from './markdown'
import type { GraphView } from './types'

// Pure model for the inline ```graph fence. The engine never depends on
// graph-engine: the host supplies renderGraph (see DocumentViewerProps).

export function isGraphFence(info: string | undefined | null): boolean {
  if (!info) return false
  return info.trim().split(/\s+/)[0] === 'graph'
}

export type GraphSize = 's' | 'm' | 'l' | 'full'

export interface GraphFenceOptions {
  size?: GraphSize
  height?: number
  view?: GraphView
  // 'xMin,xMax,yMin,yMax' form of `view`.
  bounds?: string
  lock: boolean
}

const MIN_HEIGHT = 80
const MAX_HEIGHT = 2000
const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
const AXIS_RE = new RegExp(`^([xy]):(${NUM})\\.\\.(${NUM})$`)

function parseView(raw: string): GraphView | null {
  const axes: Partial<Record<'x' | 'y', [number, number]>> = {}
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  for (const part of parts) {
    const m = AXIS_RE.exec(part)
    if (!m) return null
    const axis = m[1] as 'x' | 'y'
    const lo = Number(m[2])
    const hi = Number(m[3])
    if (axes[axis] || !Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) return null
    axes[axis] = [lo, hi]
  }
  return axes.x && axes.y ? { x: axes.x, y: axes.y } : null
}

// Parses the options after `graph` in the fence info string. Never throws;
// unknown or malformed tokens are ignored.
export function parseGraphInfo(info: string | undefined | null): GraphFenceOptions {
  const out: GraphFenceOptions = { lock: false }
  if (!info) return out
  const tokens = info.trim().split(/\s+/).slice(1)
  for (const tok of tokens) {
    if (tok === 'lock') {
      out.lock = true
      continue
    }
    const eq = tok.indexOf('=')
    if (eq < 0) continue
    const key = tok.slice(0, eq)
    const val = tok.slice(eq + 1)
    if (key === 'size') {
      if (val === 's' || val === 'm' || val === 'l' || val === 'full') out.size = val
    } else if (key === 'height') {
      if (/^\d+$/.test(val)) {
        const n = Number(val)
        if (Number.isFinite(n)) out.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, n))
      }
    } else if (key === 'view') {
      const v = parseView(val)
      if (v) {
        out.view = v
        out.bounds = `${v.x[0]},${v.x[1]},${v.y[0]},${v.y[1]}`
      }
    } else if (key === 'lock') {
      if (val === 'true') out.lock = true
      else if (val === 'false') out.lock = false
    }
  }
  return out
}

const WIDTH_PCT: Record<GraphSize, number> = { s: 40, m: 60, l: 80, full: 100 }

export function graphFenceStyle(parsed: GraphFenceOptions): { widthPct: number; height?: number } {
  const widthPct = parsed.size ? WIDTH_PCT[parsed.size] : 100
  return parsed.height !== undefined ? { widthPct, height: parsed.height } : { widthPct }
}

// Stable signature of the options, for remount keys.
export function graphOptionsSignature(o: GraphFenceOptions): string {
  return [o.size ?? '', o.height ?? '', o.bounds ?? '', o.lock ? 'L' : ''].join('|')
}

export interface GraphFenceModel {
  spec: string
  // Offset of the fence BODY in the document text (same index space as the
  // other block starts). Exposed in a non-`data-start` attribute.
  startOffset: number
  options: GraphFenceOptions
}

export function graphFenceModel(block: MdBlock, text: string): GraphFenceModel | null {
  if (block.type !== 'fence' || !isGraphFence(block.info)) return null
  return {
    spec: text.slice(block.start, block.end),
    startOffset: block.start,
    options: parseGraphInfo(block.info),
  }
}

export function graphBlocks(text: string): GraphFenceModel[] {
  const out: GraphFenceModel[] = []
  for (const b of parseBlocks(text)) {
    const m = graphFenceModel(b, text)
    if (m) out.push(m)
  }
  return out
}

export function graphErrorSummary(messages: string[]): string | null {
  const distinct = [...new Set(messages.map((m) => m.trim()).filter((m) => m.length > 0))]
  return distinct.length > 0 ? `Graph error: ${distinct.join('; ')}` : null
}
