import { mayHold } from './newMenu'
import { freeNameOf, type NodeKind, type NodeSummary, type PlacedRow } from './wsApi'

// Putting an existing node somewhere, as plain functions so the rules are tested
// without a server or a DOM. Three entries share them: "+ Existing …",
// "Place in…" on a row, and Undo after "Remove from …". Names live on
// placements and are unique among a container's live children, so a place can
// meet a name that is taken; the server answers with a free one.

// The one call these make: wsApi.placeNode, or a double of it in a test.
export type PlaceFn = (containerId: string, childId: string, name?: string) => Promise<{ name: string }>

// Place; if the name is taken, once more under the free name the server
// suggests. Only that one retry, and only for a name clash that carries a
// suggestion: any other failure, and a second failure, go to the caller.
// `fellBack` says the name is not the one asked for, so the caller can tell
// the user.
export async function placeWithFallback(
  place: PlaceFn,
  containerId: string,
  childId: string,
  name?: string
): Promise<{ name: string; fellBack: boolean }> {
  try {
    const placed = await place(containerId, childId, name)
    return { name: placed.name, fellBack: false }
  } catch (err) {
    const free = freeNameOf(err)
    if (free === null) throw err
    const placed = await place(containerId, childId, free)
    return { name: placed.name, fellBack: true }
  }
}

// A place something could be put: a container and how to show it.
export interface PlaceTarget {
  id: string
  kind: NodeKind
  label: string
}

// Trajectories, tracks and courses as places to put something, by their titles:
// where an unplaced node can go from the picker or the scratch view, which have
// no workspace root to walk down from.
export const topTargets = (nodes: NodeSummary[]): PlaceTarget[] => nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.title }))

const collator = new Intl.Collator('en', { numeric: true })
const natural = (a: string, b: string): number => collator.compare(a, b)

// The workspace root and every folder and track reachable in it, each labelled
// by the names on the way down from the root. `rows` is everything under the
// root, one row per live placement (the scope-only search). A folder or track
// placed in several ways is one target, labelled by its shortest route (by name
// among equal routes). The walk goes through tracks, courses and folders alike,
// so a folder inside a course inside a track is found. A track is a place
// because a trajectory's courses can be put into it from here; a course itself
// is not offered, since putting something into a course is what opening that
// course is for.
export function workspaceTargets(root: { id: string; kind: NodeKind; title: string }, rows: PlacedRow[]): PlaceTarget[] {
  const byContainer = new Map<string, PlacedRow[]>()
  for (const r of rows) {
    if (r.container_id === null) continue
    const list = byContainer.get(r.container_id)
    if (list) list.push(r)
    else byContainer.set(r.container_id, [r])
  }
  const seen = new Set<string>([root.id])
  const places: PlaceTarget[] = []
  // Breadth first, so the first route found to a node is a shortest one. The
  // seen set is also what stops a loop, though the graph has none.
  let level: { id: string; path: string[] }[] = [{ id: root.id, path: [root.title] }]
  while (level.length > 0) {
    const next: { id: string; path: string[] }[] = []
    for (const at of level) {
      const children = [...(byContainer.get(at.id) ?? [])].sort((a, b) => natural(a.name, b.name))
      for (const child of children) {
        if (seen.has(child.node.id)) continue
        seen.add(child.node.id)
        const path = [...at.path, child.name]
        if (child.node.kind === 'folder' || child.node.kind === 'track') places.push({ id: child.node.id, kind: child.node.kind, label: path.join(' / ') })
        if (child.node.kind !== 'file') next.push({ id: child.node.id, path })
      }
    }
    level = next
  }
  places.sort((a, b) => natural(a.label, b.label))
  return [{ id: root.id, kind: root.kind, label: root.title }, ...places]
}

// Everything inside a container, at any depth, from the rows of a search.
function insideOf(nodeId: string, rows: PlacedRow[]): Set<string> {
  const inside = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const at = queue.pop()!
    for (const r of rows) {
      if (r.container_id === at && !inside.has(r.node.id)) {
        inside.add(r.node.id)
        queue.push(r.node.id)
      }
    }
  }
  return inside
}

// Of the candidates, the ones `node` may be placed in: the containment matrix
// allows the container to hold this kind (newMenu.ts), it is not the node
// itself, not somewhere it already is (a second placement in the same container
// is refused), and, for a container, not anything inside it (that would make a
// loop). The inside is worked out from `rows`, which need only cover the
// workspace the candidates came from. The server enforces all of this too; this
// is so the list only offers what it will take.
export function placeTargets(
  node: { id: string; kind: NodeKind },
  candidates: PlaceTarget[],
  opts: { alreadyIn?: string[]; rows?: PlacedRow[] } = {}
): PlaceTarget[] {
  const already = new Set(opts.alreadyIn ?? [])
  const inside = node.kind === 'file' || !opts.rows ? new Set<string>() : insideOf(node.id, opts.rows)
  return candidates.filter((c) => c.id !== node.id && !already.has(c.id) && !inside.has(c.id) && mayHold(c.kind, node.kind))
}
