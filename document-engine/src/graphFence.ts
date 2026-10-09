import { parseBlocks, type MdBlock } from './markdown'

// Pure model for the inline ```graph fence. The engine never depends on
// graph-engine: the host supplies renderGraph (see DocumentViewerProps).

export function isGraphFence(info: string | undefined | null): boolean {
  if (!info) return false
  return info.trim().split(/\s+/)[0] === 'graph'
}

export interface GraphFenceModel {
  spec: string
  // Offset of the fence BODY in the document text (same index space as the
  // other block starts). Exposed in a non-`data-start` attribute.
  startOffset: number
}

export function graphFenceModel(block: MdBlock, text: string): GraphFenceModel | null {
  if (block.type !== 'fence' || !isGraphFence(block.info)) return null
  return { spec: text.slice(block.start, block.end), startOffset: block.start }
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
