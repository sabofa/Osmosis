import { getContent, isStale, saveContent } from './wsApi'

// The never-overwrite save, as plain functions over an API they are given, so
// the rules are tested without a server or a DOM and every file type that
// Ben and the tutor both write goes through the same ones (useFileDraft is the
// React side). The rules:
//   - A save names the revision the edit started from (`base`). The server
//     refuses it with a 409 if the file has moved on, and that is a conflict
//     to show, never something to retry.
//   - Overwrite is the one way to put Ben's text over someone else's: it reads
//     where the file is now and saves on top of that, once. If the file moved
//     again in between, that is a conflict again.
//   - Reload takes the file as it is now, and the caller drops its draft.

export interface SaveApi {
  save(nodeId: string, body: string, base: number): Promise<{ revision: number }>
  read(nodeId: string): Promise<{ body: string | null; revision: number }>
}

export const wsSaveApi: SaveApi = { save: saveContent, read: getContent }

export type SaveResult = { kind: 'saved'; revision: number } | { kind: 'conflict' } | { kind: 'failed'; message: string }
export type ReloadResult = { kind: 'loaded'; body: string; revision: number } | { kind: 'failed'; message: string }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function trySave(api: SaveApi, nodeId: string, body: string, base: number): Promise<SaveResult> {
  try {
    const out = await api.save(nodeId, body, base)
    return { kind: 'saved', revision: out.revision }
  } catch (err) {
    return isStale(err) ? { kind: 'conflict' } : { kind: 'failed', message: messageOf(err) }
  }
}

export async function tryOverwrite(api: SaveApi, nodeId: string, body: string): Promise<SaveResult> {
  let now: { revision: number }
  try {
    now = await api.read(nodeId)
  } catch (err) {
    return { kind: 'failed', message: messageOf(err) }
  }
  return trySave(api, nodeId, body, now.revision)
}

export async function tryReload(api: SaveApi, nodeId: string): Promise<ReloadResult> {
  try {
    const now = await api.read(nodeId)
    return { kind: 'loaded', body: now.body ?? '', revision: now.revision }
  } catch (err) {
    return { kind: 'failed', message: messageOf(err) }
  }
}

// Unsaved edits outlive a view: the centre pane unmounts a file's view when
// Ben switches tab, and losing a half-written note to a tab click would be
// worse than anything the frame can do. A draft is dropped when it is saved or
// discarded; otherwise it waits here for the file to be opened again. (Gone on
// a page reload; this is memory, not storage.)
export interface StoredDraft {
  text: string
  // The revision the draft started from: what its save names as the base.
  base: number
}

const drafts = new Map<string, StoredDraft>()

export const draftFor = (nodeId: string): StoredDraft | null => drafts.get(nodeId) ?? null

export function keepDraft(nodeId: string, draft: StoredDraft | null): void {
  if (draft) drafts.set(nodeId, draft)
  else drafts.delete(nodeId)
}
