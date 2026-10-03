import { useEffect, useState } from 'react'
import { draftFor, keepDraft, tryMerge, tryOverwrite, tryReload, trySave, wsSaveApi, type SaveResult } from './saveFlow'

// Everything a file view needs to let Ben edit a file that the tutor or the
// planner may also be writing, without ever silently overwriting them. Every
// type that is written from both sides (markdown, item files, USERNOTES, ...)
// should edit through this rather than calling saveContent itself: a naive
// "save, and on a 409 try again" is exactly the overwrite this exists to stop.
//
//   - `draft` is the unsaved text (a file's body is text; a type with
//     structure serialises it into the draft). It is null until editing starts
//     and survives the view being unmounted by a tab switch.
//   - `save()` writes it against the revision the draft started from. If the
//     file has moved on, `conflict` turns true and nothing is written; show a
//     ConflictBanner and let Ben choose.
//   - `reload()` takes the file as it is now and drops the draft; `overwrite()`
//     reads where the file is now and saves the draft on top of that.
//   - `addition` is set with a conflict when the only thing that happened to
//     the file is that text was added at its end (the tutor appending to
//     USERNOTES). `merge()` then saves the draft plus that text on top of where
//     the file is now, so neither side is lost; the draft becomes the merged
//     text. The hook keeps the text the draft started from for this.
//   - `saved` is what the server holds as far as this view knows. After mount
//     the view owns its state, so it does not follow `body` and `revision`
//     props (see FileViewProps).
export interface FileDraft {
  saved: { body: string; revision: number }
  draft: string | null
  // Whether the draft differs from what is saved.
  dirty: boolean
  // A draft was waiting when this view mounted (the file was left half-edited).
  restored: boolean
  // Begin a draft from the saved text, if there is not one already.
  startDraft(): void
  setDraft(text: string): void
  // Drop the draft and any message about it.
  discard(): void
  save(): Promise<void>
  conflict: boolean
  // With a conflict: what was added at the end of the file since the draft
  // started, when that is all that changed. Null when a merge is not safe.
  addition: string | null
  merge(): Promise<void>
  // True when the reload took effect.
  reload(): Promise<boolean>
  overwrite(): Promise<void>
  busy: boolean
  error: string | null
}

export function useFileDraft({
  nodeId,
  body,
  revision,
  onSaved,
}: {
  nodeId: string
  body: string | null
  revision: number
  onSaved(revision: number): void
}): FileDraft {
  const [saved, setSaved] = useState({ body: body ?? '', revision })
  const [draft, setDraftText] = useState<string | null>(() => draftFor(nodeId)?.text ?? null)
  // The revision the draft started from, and the text of that revision.
  const [base, setBase] = useState(() => draftFor(nodeId)?.base ?? revision)
  const [baseBody, setBaseBody] = useState(() => draftFor(nodeId)?.baseBody ?? body ?? '')
  const [restored] = useState(() => draftFor(nodeId) !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [addition, setAddition] = useState<string | null>(null)

  const dirty = draft !== null && draft !== saved.body

  useEffect(() => {
    keepDraft(nodeId, dirty && draft !== null ? { text: draft, base, baseBody } : null)
  }, [nodeId, dirty, draft, base, baseBody])

  // The draft starts from what is saved now.
  function startFromSaved() {
    setBase(saved.revision)
    setBaseBody(saved.body)
  }

  function startDraft() {
    if (draft !== null) return
    setDraftText(saved.body)
    startFromSaved()
  }

  function setDraft(text: string) {
    if (draft === null) startFromSaved()
    setDraftText(text)
  }

  function clearConflict() {
    setConflict(false)
    setAddition(null)
  }

  function discard() {
    setDraftText(null)
    clearConflict()
    setError(null)
  }

  function apply(result: SaveResult, text: string) {
    if (result.kind === 'saved') {
      // A merge saves more than the draft: the draft is what the file holds now.
      const now = result.body ?? text
      setSaved({ body: now, revision: result.revision })
      setBase(result.revision)
      setBaseBody(now)
      if (result.body !== undefined) setDraftText(now)
      clearConflict()
      onSaved(result.revision)
    } else if (result.kind === 'conflict') {
      setConflict(true)
      setAddition(result.addition ?? null)
    } else {
      setError(result.message)
    }
  }

  async function run(go: (text: string) => Promise<SaveResult>) {
    if (draft === null) return
    setBusy(true)
    setError(null)
    apply(await go(draft), draft)
    setBusy(false)
  }

  const save = () => run((text) => trySave(wsSaveApi, nodeId, text, base, baseBody))
  const overwrite = () => run((text) => tryOverwrite(wsSaveApi, nodeId, text, baseBody))
  const merge = () => run((text) => tryMerge(wsSaveApi, nodeId, text, baseBody))

  async function reload(): Promise<boolean> {
    setBusy(true)
    setError(null)
    const result = await tryReload(wsSaveApi, nodeId)
    setBusy(false)
    if (result.kind === 'failed') {
      setError(result.message)
      return false
    }
    setSaved({ body: result.body, revision: result.revision })
    setBase(result.revision)
    setBaseBody(result.body)
    setDraftText(null)
    clearConflict()
    onSaved(result.revision)
    return true
  }

  return { saved, draft, dirty, restored, startDraft, setDraft, discard, save, conflict, addition, merge, reload, overwrite, busy, error }
}
