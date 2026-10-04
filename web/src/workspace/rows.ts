import type { NewKind } from './newMenu'
import type { AppearsInRow, ChildRow, NodeKind, NodeSummary } from './wsApi'

// What a tree row shows and acts on. `placementId` and `container` are null
// where the row is not reached through a placement of a known container; such
// a row has no rename-here and no remove-from-here, only what needs the node.
export interface RowModel {
  key: string
  node: NodeSummary
  name: string
  placementId: string | null
  container: { id: string; title: string } | null
}

// A trajectory, a track or a course opens as a workspace of its own.
export type WorkspaceKind = 'trajectory' | 'track' | 'course'
export const isWorkspaceKind = (kind: NodeKind): kind is WorkspaceKind => kind === 'trajectory' || kind === 'track' || kind === 'course'

// One section of the sidebar for a workspace: what it is called, which kinds of
// child it lists (and so which "+ …" links it has), and which of those can also
// be added as an existing node ("+ Existing course…").
export interface Section {
  key: 'files' | 'planning' | 'members'
  title: string
  kinds: readonly NodeKind[]
  existing: readonly NewKind[]
  empty: string
}

// A course is one list. A track is Planning (what is not a course) and its
// Courses. A trajectory has the same two sections, the second holding both its
// tracks and its courses. Between them a workspace's sections show every kind
// its container may hold (the matrix, newMenu.ts), each in exactly one.
export function sidebarSections(kind: WorkspaceKind): Section[] {
  if (kind === 'course') return [{ key: 'files', title: 'Files', kinds: ['folder', 'file'], existing: [], empty: 'This course is empty.' }]
  const planning: Section = { key: 'planning', title: 'Planning', kinds: ['folder', 'file'], existing: [], empty: 'Nothing in the plan yet.' }
  if (kind === 'track') return [planning, { key: 'members', title: 'Courses', kinds: ['course'], existing: ['course'], empty: 'No courses in this track.' }]
  return [planning, { key: 'members', title: 'Tracks and courses', kinds: ['track', 'course'], existing: ['track', 'course'], empty: 'No tracks or courses in this trajectory yet.' }]
}

export const showsRow = (section: Section, row: ChildRow): boolean => section.kinds.includes(row.node.kind)

// The existing nodes of these kinds that a container could still be given: not
// the container itself, and not one it already holds directly. A node can sit
// in several places, so one that is placed elsewhere is still offered here. (A
// track or a course cannot close a loop in a trajectory or a track, since the
// matrix lets nothing they hold hold them back.)
export function addableNodes(all: NodeSummary[], kinds: readonly NodeKind[], children: ChildRow[], containerId: string): NodeSummary[] {
  const held = new Set(children.map((c) => c.node.id))
  return all.filter((n) => kinds.includes(n.kind) && n.id !== containerId && !held.has(n.id))
}

// The header's "in: …" of a course or a track: the trajectories and tracks it
// appears in, each a workspace to open. (A folder is no workspace, and a
// container holding it under two names is still one entry.)
export function parentWorkspaces(appearsIn: AppearsInRow[]): { id: string; kind: WorkspaceKind; title: string }[] {
  const seen = new Set<string>()
  const out: { id: string; kind: WorkspaceKind; title: string }[] = []
  for (const { container } of appearsIn) {
    if ((container.kind !== 'trajectory' && container.kind !== 'track') || seen.has(container.id)) continue
    seen.add(container.id)
    out.push({ id: container.id, kind: container.kind, title: container.title })
  }
  return out
}
