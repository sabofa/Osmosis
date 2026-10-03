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
//   - Merge is for the one conflict that loses nothing: the tutor's ws_append
//     (its notes in a unit's USERNOTES) only adds text after what Ben's draft
//     started from. Then Ben's text plus those additions is saved on top of
//     where the file is now. Anything else the server changed (an edit in the
//     middle, a rewrite) is never merged: only Reload and Overwrite.

export interface SaveApi {
  save(nodeId: string, body: string, base: number): Promise<{ revision: number }>
  read(nodeId: string): Promise<{ body: string | null; revision: number }>
}

export const wsSaveApi: SaveApi = { save: saveContent, read: getContent }

// `body` on a saved result is the text the file now holds when that is not what
// was handed in (a merge saves draft + additions). `addition` on a conflict is
// the text the server gained at the end since the draft started, present only
// when that is all that happened, so a merge is safe to offer.
export type SaveResult =
  | { kind: 'saved'; revision: number; body?: string }
  | { kind: 'conflict'; addition?: string }
  | { kind: 'failed'; message: string }
export type ReloadResult = { kind: 'loaded'; body: string; revision: number } | { kind: 'failed'; message: string }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// Is the server's text the draft's starting text with more after it? Then
// the result is the draft plus that addition. Compared exactly (no trimming, no
// line-ending folding): a prefix that is only nearly one means the text was
// edited, and an edit is not something to merge blind. A blank line sets the
// addition apart from the draft when it would otherwise run into its last line,
// which happens when the file was empty and the tutor's first note went in
// bare (the server only adds its own blank line between existing text and an
// append).
export function mergeAppended(baseBody: string, draft: string, currentBody: string): { suffix: string; merged: string } | null {
  if (currentBody.length <= baseBody.length || !currentBody.startsWith(baseBody)) return null
  const suffix = currentBody.slice(baseBody.length)
  const apart = draft === '' || draft.endsWith('\n') || suffix.startsWith('\n') ? '' : '\n\n'
  return { suffix, merged: draft + apart + suffix }
}

// A 409. When the body the draft started from is known, look at the file as it
// is now to see whether a merge is on offer; if it cannot be read the conflict
// stands with only Reload and Overwrite.
async function conflictFor(api: SaveApi, nodeId: string, draft: string, baseBody: string | undefined): Promise<SaveResult> {
  if (baseBody === undefined) return { kind: 'conflict' }
  try {
    const now = await api.read(nodeId)
    const merge = mergeAppended(baseBody, draft, now.body ?? '')
    return merge ? { kind: 'conflict', addition: merge.suffix } : { kind: 'conflict' }
  } catch {
    return { kind: 'conflict' }
  }
}

export async function trySave(api: SaveApi, nodeId: string, body: string, base: number, baseBody?: string): Promise<SaveResult> {
  try {
    const out = await api.save(nodeId, body, base)
    return { kind: 'saved', revision: out.revision }
  } catch (err) {
    return isStale(err) ? conflictFor(api, nodeId, body, baseBody) : { kind: 'failed', message: messageOf(err) }
  }
}

export async function tryOverwrite(api: SaveApi, nodeId: string, body: string, baseBody?: string): Promise<SaveResult> {
  let now: { revision: number }
  try {
    now = await api.read(nodeId)
  } catch (err) {
    return { kind: 'failed', message: messageOf(err) }
  }
  return trySave(api, nodeId, body, now.revision, baseBody)
}

// Draft plus their additions, saved on top of where the file is now. The file
// is read again first (it may have moved since the banner was shown): if it is
// no longer a pure append nothing is saved, and if it moved between the read and
// the save the 409 is a conflict again, with the offer worked out afresh.
export async function tryMerge(api: SaveApi, nodeId: string, draft: string, baseBody: string): Promise<SaveResult> {
  let now: { body: string | null; revision: number }
  try {
    now = await api.read(nodeId)
  } catch (err) {
    return { kind: 'failed', message: messageOf(err) }
  }
  const merge = mergeAppended(baseBody, draft, now.body ?? '')
  if (!merge) return { kind: 'conflict' }
  const out = await trySave(api, nodeId, merge.merged, now.revision)
  if (out.kind === 'saved') return { kind: 'saved', revision: out.revision, body: merge.merged }
  return out.kind === 'conflict' ? conflictFor(api, nodeId, draft, baseBody) : out
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
  // The text of that revision, so a conflict can tell whether the file only
  // grew since (the tutor's appended notes) and a merge can be offered.
  baseBody: string
}

const drafts = new Map<string, StoredDraft>()

export const draftFor = (nodeId: string): StoredDraft | null => drafts.get(nodeId) ?? null

export function keepDraft(nodeId: string, draft: StoredDraft | null): void {
  if (draft) drafts.set(nodeId, draft)
  else drafts.delete(nodeId)
}
