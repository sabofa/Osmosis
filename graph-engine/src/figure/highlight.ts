import type { FigureTarget } from './hitItems'

// Which elements of a rendered figure light up for a hovered or a selected
// item. The markup is never changed to say so: the view adds a class to the
// elements that already carry the identity (`data-statement`, `data-object`),
// which is why it works under every style.

function matchesAny(statement: string | null, object: string | null, targets: readonly FigureTarget[]): boolean {
  if (statement === null) return false
  for (const target of targets) {
    if (String(target.statement) !== statement) continue
    // A target without an object means the whole statement; one with an
    // object means that object only.
    if (target.object === null || target.object === object) return true
  }
  return false
}

// `statement` and `object` are the element's attribute text, null when absent.
export function highlightOf(
  statement: string | null,
  object: string | null,
  hovered: readonly FigureTarget[],
  selected: readonly FigureTarget[],
): { hovered: boolean; selected: boolean } {
  return { hovered: matchesAny(statement, object, hovered), selected: matchesAny(statement, object, selected) }
}
