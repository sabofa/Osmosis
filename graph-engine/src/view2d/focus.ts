// Focus by coordinates: "@focus: (3, 2) zoom 4" says where a 2D view should
// be looking, in the author's own coordinates rather than the engine's. Pure
// and DOM-free; the parser reads the directive through `parseFocus`, and each
// engine supplies an `AuthorMapping` saying where an author's point lands in
// its content units.
import { formatPoint, formatZoom } from './readout'
import type { Camera, Vec } from './types'

export type FocusTarget =
  | { kind: 'plane'; x: number; y: number }
  | { kind: 'space'; x: number; y: number; z: number }
  | { kind: 'view'; u: number; v: number } // the engine's own content units

export interface FocusSpec {
  target: FocusTarget
  zoom: number
}

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`
const FOCUS = new RegExp(
  String.raw`^(view\s*)?\(\s*(${NUM})\s*,\s*(${NUM})\s*(?:,\s*(${NUM})\s*)?\)(?:\s*zoom\s+(${NUM}))?$`,
  'i'
)

export function parseFocus(value: string): FocusSpec {
  const text = value.trim()
  const m = FOCUS.exec(text)
  // "view (u, v)" has two numbers; a third belongs to the space form only.
  if (!m || (m[1] && m[4] !== undefined)) {
    throw new Error(
      `@focus must be "(x, y)", "(x, y, z)" or "view (u, v)", optionally followed by "zoom <k>" — got "${value}"`
    )
  }
  const a = Number(m[2])
  const b = Number(m[3])
  let zoom = 1
  if (m[5] !== undefined) {
    zoom = Number(m[5])
    if (!(zoom > 0) || !Number.isFinite(zoom)) {
      throw new Error(`@focus zoom must be greater than 0 — got "${m[5]}"`)
    }
  }
  let target: FocusTarget
  if (m[1]) target = { kind: 'view', u: a, v: b }
  else if (m[4] !== undefined) target = { kind: 'space', x: a, y: b, z: Number(m[4]) }
  else target = { kind: 'plane', x: a, y: b }
  return { target, zoom }
}

// The directive's value only, in the form parseFocus reads back: "(3, 2) zoom 4".
// A zoom of 1 is the default and is left out.
export function formatFocus(spec: FocusSpec): string {
  const t = spec.target
  const point =
    t.kind === 'plane' ? formatPoint([t.x, t.y]) : t.kind === 'space' ? formatPoint([t.x, t.y, t.z]) : `view ${formatPoint([t.u, t.v])}`
  const zoom = formatZoom(spec.zoom).replace('×', '')
  return zoom === '1' ? point : `${point} zoom ${zoom}`
}

// An engine's account of where an author's coordinates land in its own content
// units. Null: this engine cannot place that form (a 2D plot has no z).
export interface AuthorMapping {
  toContent(target: FocusTarget): Vec | null
}

// The camera a focus asks for, or null when the engine cannot place it. The
// zoom is passed through unclamped: the motion clamps to its own limits.
export function focusCamera(spec: FocusSpec, mapping: AuthorMapping): Camera | null {
  const at = mapping.toContent(spec.target)
  return at ? { cx: at.x, cy: at.y, zoom: spec.zoom } : null
}
