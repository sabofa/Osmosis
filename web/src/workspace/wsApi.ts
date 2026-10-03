// The workspace graph over HTTP: one function per /api/ws route
// (server/src/http/workspaceRoutes.ts). List routes answer bare arrays; an
// error answers {error, message, detail?}, which is what WsError carries so a
// caller can tell a 409 (the file moved on) or a name clash from any other
// failure. The local node's offline answer is {reason, message} with a 503;
// that rides in the same fields.

export type NodeKind = 'track' | 'course' | 'folder' | 'file'
export type KindTag = 'source' | 'resource' | 'homework' | 'test' | 'flowchart'
export const KIND_TAGS: readonly KindTag[] = ['source', 'resource', 'homework', 'test', 'flowchart']

export interface NodeSummary {
  id: string
  kind: NodeKind
  title: string
  kind_tag: KindTag | null
  type: string | null
  class: string | null
  placement_count: number
  has_children: boolean
  trashed_at: string | null
}

export interface ChildRow {
  placement_id: string
  name: string
  node: NodeSummary
}

export interface AppearsInRow {
  placement_id: string
  container: { id: string; kind: NodeKind; title: string }
  name: string
}

export interface NodeDetail {
  node: NodeSummary
  appears_in: AppearsInRow[]
  parent_tracks: { id: string; title: string }[]
  file: { type: string; revision: number; saved_at: string; saved_by: 'ben' | 'tutor' | 'planner'; asset_id: string | null } | null
}

export interface Roots {
  tracks: NodeSummary[]
  courses: NodeSummary[]
  unplaced: NodeSummary[]
}

export interface CourseRow {
  node: NodeSummary
  path: string[]
}

export interface SearchRow {
  placement_id: string | null
  name: string
  node: NodeSummary
  container_id: string | null
}

export interface FileContent {
  type: string
  body: string | null
  asset_id: string | null
  revision: number
  saved_at: string
  saved_by: 'ben' | 'tutor' | 'planner'
}

// A failed call. `status` is the HTTP status (0 when the server was not
// reached at all), `code` the server's error code ("stale_revision",
// "name_taken", "not_found", ...) and `detail` whatever it attached: the
// current revision of a 409, the free name of a name_taken (whose message also
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
export const getNodeDetail = (id: string) => call<NodeDetail>('GET', `/nodes/${enc(id)}`)
export const getChildren = (id: string) => call<ChildRow[]>('GET', `/nodes/${enc(id)}/children`)
export const getCourses = (trackId: string) => call<CourseRow[]>('GET', `/nodes/${enc(trackId)}/courses`)
export const getContent = (id: string) => call<FileContent>('GET', `/nodes/${enc(id)}/content`)
export const searchByTag = (scope: string, kindTag: KindTag) =>
  call<SearchRow[]>('GET', `/search?scope=${enc(scope)}&kind_tag=${enc(kindTag)}`)

// ---- writes ------------------------------------------------------------------

export const saveContent = (id: string, body: string, baseRevision: number) =>
  call<{ revision: number; saved_at: string }>('PUT', `/nodes/${enc(id)}/content`, { body, base_revision: baseRevision })

export interface CreateInput {
  kind: NodeKind
  title: string
  file?: { type: string; body: string | null }
  placeIn?: string
}

export const createNode = (input: CreateInput) =>
  call<{ node: { id: string; kind: NodeKind; title: string }; placement: { id: string; name: string } | null }>('POST', '/nodes', {
    kind: input.kind,
    title: input.title,
    ...(input.file ? { file: input.file } : {}),
    ...(input.placeIn ? { place_in: { container_id: input.placeIn } } : {}),
  })

// Rename here: one placement's name, nothing else.
export const renamePlacement = (placementId: string, name: string) => call<{ id: string; name: string }>('PATCH', `/placements/${enc(placementId)}`, { name })

// Remove from here: one placement goes, the node lives on (unplaced if it was
// the last). Deliberately not the same call as destroyNode.
export const removePlacement = (placementId: string) =>
  call<{ removed: { id: string }; became_unplaced: boolean }>('DELETE', `/placements/${enc(placementId)}`)

// Destroy: the node goes to the trash, wherever it is placed. With orphans, so
// do the items under it that are placed nowhere else.
export const destroyNode = (id: string, withOrphans: boolean) =>
  call<{ trashed: string[] }>('DELETE', `/nodes/${enc(id)}${withOrphans ? '?with_orphans=true' : ''}`)
