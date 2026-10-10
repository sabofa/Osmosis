// Turns the ragged per-span client rects of a text range into clean
// highlight bars: one continuous bar per visual line, with consistent height
// and no vertical overlap between lines. Pure geometry, no DOM.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MergeOptions {
  // A horizontal gap wider than this many line heights splits the bar
  // (column break) instead of being filled.
  gapFactor?: number
}

const DEFAULT_GAP_FACTOR = 2.5

const width = (r: Box) => r.right - r.left
const height = (r: Box) => r.bottom - r.top
const centreY = (r: Box) => (r.top + r.bottom) / 2

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Groups rects by line: a rect joins a line when its centre-y lies within
// half the smaller height of the line's running centre. Zero-size rects are
// dropped. Lines come back top-to-bottom.
export function groupIntoLines(rects: Box[]): Box[][] {
  const lines: { items: Box[]; cy: number; h: number }[] = []
  const sorted = rects.filter((r) => width(r) > 0 && height(r) > 0).sort((a, b) => centreY(a) - centreY(b))
  for (const r of sorted) {
    const cy = centreY(r)
    const h = height(r)
    const line = lines.find((l) => Math.abs(cy - l.cy) <= Math.min(h, l.h) / 2)
    if (line) {
      line.items.push(r)
      line.cy = median(line.items.map(centreY))
      line.h = median(line.items.map(height))
    } else lines.push({ items: [r], cy, h })
  }
  return lines.sort((a, b) => a.cy - b.cy).map((l) => l.items)
}

// One bar per contiguous run of the line's rects. Height = median height,
// centred on the median centre-y.
export function mergeLine(lineRects: Box[], opts: MergeOptions = {}): Box[] {
  const rects = lineRects.filter((r) => width(r) > 0 && height(r) > 0)
  if (rects.length === 0) return []
  const gapFactor = opts.gapFactor ?? DEFAULT_GAP_FACTOR
  const h = median(rects.map(height))
  const cy = median(rects.map(centreY))
  const top = cy - h / 2
  const bottom = cy + h / 2
  const byLeft = [...rects].sort((a, b) => a.left - b.left)
  const bars: Box[] = []
  let cur = { left: byLeft[0].left, right: byLeft[0].right }
  for (const r of byLeft.slice(1)) {
    if (r.left - cur.right > gapFactor * h) {
      bars.push({ left: cur.left, right: cur.right, top, bottom })
      cur = { left: r.left, right: r.right }
    } else cur.right = Math.max(cur.right, r.right)
  }
  bars.push({ left: cur.left, right: cur.right, top, bottom })
  return bars
}

export function mergeRects(rects: Box[], opts: MergeOptions = {}): Box[] {
  const bars = groupIntoLines(rects).flatMap((line) => mergeLine(line, opts))
  bars.sort((a, b) => a.top - b.top || a.left - b.left)
  // Neighbouring lines whose bars still touch vertically meet at the midline.
  for (let i = 0; i + 1 < bars.length; i++) {
    const a = bars[i]
    const b = bars[i + 1]
    if (a.bottom > b.top && a.left < b.right && b.left < a.right) {
      const mid = (a.bottom + b.top) / 2
      a.bottom = mid
      b.top = mid
    }
  }
  return bars
}
