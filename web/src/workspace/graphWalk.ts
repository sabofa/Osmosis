import type { AppearsInRow, ChildRow, NodeSummary } from './wsApi'

// Two walks over the file graph that the frame does in the client, written
// against injected fetchers so they are tested without a server. The server
// has no route for either: its answers are per node (children, appears-in).

// What "also destroy the items placed nowhere else" would take with a
// container: the same set the server computes. A descendant goes when every
// live placement it has is inside the set already, so an item placed under two
// folders that both go goes too. Only a container that goes is looked inside:
// a folder that stays holds nothing that is affected by this destroy.
//
// `placement_count` counts a node's placements in live containers; `edges`
// counts how many of those we have seen coming from containers in the set.
export async function orphansUnder(rootId: string, childrenOf: (id: string) => Promise<ChildRow[]>): Promise<NodeSummary[]> {
  const inSet = new Set<string>([rootId])
  const edges = new Map<string, number>()
  const found: NodeSummary[] = []
  let level = [rootId]
  while (level.length > 0) {
    const lists = await Promise.all(level.map((id) => childrenOf(id)))
    const next: string[] = []
    for (const rows of lists) {
      for (const { node } of rows) {
        if (inSet.has(node.id)) continue
        const seen = (edges.get(node.id) ?? 0) + 1
        edges.set(node.id, seen)
        if (seen < node.placement_count) continue
        inSet.add(node.id)
        found.push(node)
        if (node.has_children) next.push(node.id)
      }
    }
    level = next
  }
  return found
}

// The names from a workspace root down to a container, for a search result's
// "name — path". Walks up through the container's placements until it reaches
// the root; a container placed under something outside the workspace as well
// simply takes the route that does lead to it. Each container is asked about
// once however many results sit in it.
export function makePathResolver(
  rootId: string,
  parentsOf: (id: string) => Promise<AppearsInRow[]>
): (containerId: string) => Promise<string[] | null> {
  const parents = new Map<string, Promise<AppearsInRow[]>>()
  const settled = new Map<string, string[] | null>()
  const parentsCached = (id: string) => {
    let p = parents.get(id)
    if (!p) parents.set(id, (p = parentsOf(id)))
    return p
  }
  // The graph is acyclic (the server refuses a placement that would close a
  // loop), so this ends; the depth cap is only there so a surprise cannot hang
  // the sidebar.
  async function up(id: string, depth: number): Promise<string[] | null> {
    if (id === rootId) return []
    const known = settled.get(id)
    if (known !== undefined) return known
    if (depth > 64) return null
    for (const placement of await parentsCached(id)) {
      const above = await up(placement.container.id, depth + 1)
      if (above) {
        const path = [...above, placement.name]
        settled.set(id, path)
        return path
      }
    }
    settled.set(id, null)
    return null
  }
  return (containerId) => up(containerId, 0)
}
