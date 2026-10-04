// The workspace graph over HTTP: one function per /api/ws route
// (server/src/http/workspaceRoutes.ts). List routes answer bare arrays (only
// /roots answers an object); an error answers {error, message, detail?}, which
// is what WsError carries so a caller can tell a 409 (the file moved on) or a
// name clash from any other failure. The local node's offline answer is
// {reason, message} with a 503; that rides in the same fields.
//
// Trajectories, tracks, courses, folders and files are all nodes. A placement
// is an edge from a container to a child and carries the child's name there.

export type NodeKind = 'trajectory' | 'track' | 'course' | 'folder' | 'file'
export type Author = 'ben' | 'tutor' | 'planner'

export interface NodeSummary {
  id: string
  kind: NodeKind
  title: string
  // Open vocabulary (kindTags.ts); files only.
  kind_tag: string | null
  // A file's content format ("markdown", "graph", "upload", ...); null for the rest.
  format: string | null
  placement_count: number
  has_children: boolean
  archived_at: string | null
  // A live trajectory, track or course with no live placement: a normal state
  // for a container, unlike an unplaced file or folder.
  top_level: boolean
}

export interface ChildRow {
  placement_id: string
  name: string
  appears_elsewhere: boolean
  node: NodeSummary
}

export interface AppearsInRow {
  placement_id: string
  name: string
  container: { id: string; kind: NodeKind; title: string }
}

export interface NodeDetail {
  node: NodeSummary
  appears_in: AppearsInRow[]
  content: { format: string; version: number; saved_at: string; author: Author; asset_id: string | null } | null
}

export interface Roots {
  trajectories: NodeSummary[]
  tracks: NodeSummary[]
  courses: NodeSummary[]
}

// A live placement: what by-kind-tag and search answer, one row per placement.
export interface PlacedRow {
  placement_id: string
  name: string
  container_id: string
  node: NodeSummary
}

export interface PlacementRow {
  id: string
  container_id: string
  child_id: string
  name: string
}

// A file's latest version.
export interface FileContent {
  node_id: string
  version: number
  format: string
  body: string | null
  asset_id: string | null
  author: Author
  saved_at: string
}

export interface DeletePreview {
  appears_in: AppearsInRow[]
  // The live nodes under it that are placed nowhere else.
  orphans: NodeSummary[]
}

// One of a deleted node's marked placements, for the restore checklist.
export interface ArchivedPlacement {
  placement_id: string
  name: string
  container: { id: string; kind: NodeKind; title: string; archived: boolean }
}

export interface RestoreOutcome {
  restored: string
  // The chosen placements that came back. A name taken here since is replaced
  // by the lowest free `name (n)`, and `renamed` says so.
  placements: { placement_id: string; name: string; renamed: boolean }[]
  // Chosen, but their container is still archived: they stay marked and come
  // back when that container is restored.
  skipped: { placement_id: string; reason: 'container_archived' }[]
  // The others archived by the same delete, still archived.
  batch_mates: NodeSummary[]
}

// A failed call. `status` is the HTTP status (0 when the server was not
// reached at all), `code` the server's error code ("stale_version",
// "name_taken", "not_found", ...) and `detail` whatever it attached: the
// current version of a 409, the free name of a name_taken (whose message also
// names it, which is what the sidebar shows).
export class WsError extends Error {
  status: number
  code: string
  detail: unknown
  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message)
    this.name = 'WsError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export const isStale = (err: unknown): err is WsError => err instanceof WsError && err.status === 409

// The free name a name_taken carries, when the error is one.
export function freeNameOf(err: unknown): string | null {
  if (!(err instanceof WsError) || err.code !== 'name_taken') return null
  const suggestion = (err.detail as { suggestion?: unknown } | undefined)?.suggestion
  return typeof suggestion === 'string' ? suggestion : null
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/ws${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new WsError(0, 'network', err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) {
    let parsed: { error?: unknown; reason?: unknown; message?: unknown; detail?: unknown } = {}
    try {
      parsed = await res.json()
    } catch {
      // Not JSON (a proxy's own error page): the status line has to do.
    }
    const code = typeof parsed.error === 'string' ? parsed.error : typeof parsed.reason === 'string' ? parsed.reason : 'http_error'
    const message = typeof parsed.message === 'string' ? parsed.message : `${method} /api/ws${path} ${res.status}`
    throw new WsError(res.status, code, message, parsed.detail)
  }
  return (await res.json()) as T
}

const enc = encodeURIComponent

// ---- reads -------------------------------------------------------------------

export const getRoots = () => call<Roots>('GET', '/roots')
// Files and folders with no live placement. (Trajectories, tracks and courses
// with none are top level, and come with the roots.)
export const getUnplaced = () => call<NodeSummary[]>('GET', '/unplaced')
export const getArchive = () => call<NodeSummary[]>('GET', '/archive')
export const getNodeDetail = (id: string) => call<NodeDetail>('GET', `/nodes/${enc(id)}`)
export const getChildren = (id: string) => call<ChildRow[]>('GET', `/nodes/${enc(id)}/children`)
export const getContent = (id: string) => call<FileContent>('GET', `/nodes/${enc(id)}/content`)
export const getByKindTag = (scope: string, tag: string) => call<PlacedRow[]>('GET', `/by-kind-tag?tag=${enc(tag)}&scope=${enc(scope)}`)
// Every live placement under a container, at any depth, one row each.
export const searchUnder = (scope: string) => call<PlacedRow[]>('GET', `/search?scope=${enc(scope)}`)
export const getDeletePreview = (id: string) => call<DeletePreview>('GET', `/nodes/${enc(id)}/delete-preview`)
export const getArchivedPlacements = (id: string) => call<ArchivedPlacement[]>('GET', `/nodes/${enc(id)}/archived-placements`)

// ---- writes ------------------------------------------------------------------

export const saveContent = (id: string, body: string, baseVersion: number) =>
  call<{ version: number; saved_at: string }>('PUT', `/nodes/${enc(id)}/content`, { body, base_version: baseVersion })

// The server refuses a field it does not know, so this sends exactly these.
export interface CreateInput {
  kind: NodeKind
  title: string
  kind_tag?: string | null
  // A file needs a format; `body` is its first version.
  format?: string
  body?: string | null
  container_id?: string
  // The name in that container; the title when left out.
  name?: string
}

export const createNode = (input: CreateInput) =>
  call<{ node: { id: string; kind: NodeKind; title: string }; placement: PlacementRow | null }>('POST', '/nodes', {
    kind: input.kind,
    title: input.title,
    ...(input.kind_tag !== undefined ? { kind_tag: input.kind_tag } : {}),
    ...(input.format !== undefined ? { format: input.format } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.container_id !== undefined ? { container_id: input.container_id } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
  })

// Place an existing node in a container (the same node can sit in several).
// With no name it goes in under its own title.
export const placeNode = (containerId: string, childId: string, name?: string) =>
  call<PlacementRow>('POST', '/placements', {
    container_id: containerId,
    child_id: childId,
    ...(name !== undefined ? { name } : {}),
  })

// Rename here: one placement's name, nothing else. There is no rename-everywhere.
export const renamePlacement = (placementId: string, name: string) => call<PlacementRow>('PATCH', `/placements/${enc(placementId)}`, { name })

// Retitle a node: its fallback name (what a placement is called when it is made
// without a name, and what a trajectory, track or course is called at the top
// level). A name in one container is renamePlacement, not this.
export const retitleNode = (id: string, title: string) => call<{ id: string; title: string }>('PATCH', `/nodes/${enc(id)}`, { title })

// What a file is for, or null for nothing. One tag per file, any valid tag.
export const setKindTag = (id: string, kindTag: string | null) => call<{ id: string }>('PATCH', `/nodes/${enc(id)}`, { kind_tag: kindTag })

// Trash: this one placement goes, the node lives on (unplaced if it was the
// last). Deliberately not the same call as deleteNode.
export const trashPlacement = (placementId: string) =>
  call<{ removed: PlacementRow; became_unplaced: boolean }>('DELETE', `/placements/${enc(placementId)}`)

// Delete: the node goes to the Archive, wherever it is placed. With orphans, so
// do the items under it that are placed nowhere else.
export const deleteNode = (id: string, withOrphans: boolean) =>
  call<{ archived: string[]; batch: string }>('DELETE', `/nodes/${enc(id)}${withOrphans ? '?with_orphans=true' : ''}`)

// ---- the archive -------------------------------------------------------------

// Bring a node back with exactly the placements chosen (an empty list brings it
// back unplaced; the unchosen are forgotten).
export const restoreNode = (id: string, placementIds: string[]) =>
  call<RestoreOutcome>('POST', `/nodes/${enc(id)}/restore`, { placements: placementIds })

// Delete an archived node for good. Refused with asset_in_use for an upload that
// still exists: the upload is deleted in Settings, not here.
export const purgeNode = (id: string) => call<{ purged: string }>('DELETE', `/archive/${enc(id)}`)
