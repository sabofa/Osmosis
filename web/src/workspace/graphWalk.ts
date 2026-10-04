import type { AppearsInRow } from './wsApi'

// The one walk over the graph that the frame does in the client, written
// against an injected fetcher so it is tested without a server. (The other it
// used to do, the items a delete would also take, is the server's now:
// GET /nodes/:id/delete-preview.)

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
