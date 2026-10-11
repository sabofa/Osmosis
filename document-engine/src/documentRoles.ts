// Semantic roles of a document's top-level blocks: the hooks a theme (or the
// future theme adapter) styles through [data-role] / [data-section-index].
//   title   the first H1
//   lede    the paragraph that DIRECTLY follows the title (no other block between)
//   section every H2, numbered 1..n in document order
// Only top-level blocks count: a heading inside a quote is never a title or a
// section. Pure and shared by the read-mode renderer (markdown.ts blocks) and
// the live-preview editor (lezer tree), so both agree.

export type RoleKind = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'other'

export interface BlockRole {
  role?: 'title' | 'lede' | 'section'
  // 1-based, sections only.
  sectionIndex?: number
  // 1..6 for headings.
  level?: number
}

const LEVEL = /^h([1-6])$/

// `blocks[i].type` is a markdown.ts BlockType ('h1'|'h2'|'h3'|'p'|...) or any
// of the RoleKind strings; anything else is a non-paragraph, non-heading block.
export function documentRoles(blocks: readonly { type: string }[]): BlockRole[] {
  const out: BlockRole[] = []
  let titleAt = -1
  let sections = 0
  blocks.forEach((b, i) => {
    const m = LEVEL.exec(b.type)
    const r: BlockRole = {}
    if (m) {
      r.level = Number(m[1])
      if (r.level === 1 && titleAt < 0) {
        titleAt = i
        r.role = 'title'
      } else if (r.level === 2) {
        r.role = 'section'
        r.sectionIndex = ++sections
      }
    } else if (b.type === 'p' && titleAt >= 0 && i === titleAt + 1) {
      r.role = 'lede'
    }
    out.push(r)
  })
  return out
}

// The lezer top-level node names -> RoleKind (ATX and setext headings alike).
export function roleKindOfNode(name: string): RoleKind {
  const m = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)
  if (m) return `h${m[1]}` as RoleKind
  return name === 'Paragraph' ? 'p' : 'other'
}
