import type { ChildRow, CourseRow, NodeSummary } from './wsApi'

// What a tree row shows and acts on. `placementId` and `container` are null
// where the row is not reached through a placement of a known container; such
// a row has no rename-here and no remove-from-here, only what needs the node.
export interface RowModel {
  key: string
  node: NodeSummary
  name: string
  // Shown in place of `name` (the Courses list shows the path).
  label?: string
  placementId: string | null
  container: { id: string; title: string } | null
}

// The rows of a track's Courses list. A course reached through a folder is
// shown by its path and has no placement of the track's to act on. A course
// placed directly in the track (a path of one name) is that placement, which
// the track's own children read has, so the row can be renamed here and
// removed from the track, as separate things from destroying it.
export function courseRowModels(courses: CourseRow[], trackChildren: ChildRow[], track: { id: string; title: string }): RowModel[] {
  const direct = new Map(trackChildren.map((c) => [c.node.id, c]))
  return courses.map(({ node, path }) => {
    const placement = path.length === 1 ? direct.get(node.id) : undefined
    return {
      key: node.id,
      node,
      name: path.at(-1) ?? node.title,
      label: path.join(' / '),
      placementId: placement?.placement_id ?? null,
      container: placement ? { id: track.id, title: track.title } : null,
    }
  })
}

// The courses that can still be added to a track: live courses (the roots
// read lists them all) that the track does not already reach, by any route.
export function addableCourses(all: NodeSummary[], reach: CourseRow[]): NodeSummary[] {
  const inReach = new Set(reach.map((r) => r.node.id))
  return all.filter((n) => n.kind === 'course' && !inReach.has(n.id))
}
