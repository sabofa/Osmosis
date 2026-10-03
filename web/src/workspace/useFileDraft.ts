import { useEffect, useState } from 'react'
import { draftFor, keepDraft, tryOverwrite, tryReload, trySave, wsSaveApi, type SaveResult } from './saveFlow'

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
  // The revision the draft started from.
  const [base, setBase] = useState(() => draftFor(nodeId)?.base ?? revision)
  const [restored] = useState(() => draftFor(nodeId) !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const dirty = draft !== null && draft !== saved.body

  useEffect(() => {
    keepDraft(nodeId, dirty && draft !== null ? { text: draft, base } : null)
  }, [nodeId, dirty, draft, base])

  function startDraft() {
    if (draft !== null) return
    setDraftText(saved.body)
    setBase(saved.revision)
  }

  function setDraft(text: string) {
    if (draft === null) setBase(saved.revision)
    setDraftText(text)
  }

  function discard() {
    setDraftText(null)
    setConflict(false)
    setError(null)
  }

  function apply(result: SaveResult, text: string) {
    if (result.kind === 'saved') {
      setSaved({ body: text, revision: result.revision })
      setBase(result.revision)
      setConflict(false)
      onSaved(result.revision)
    } else if (result.kind === 'conflict') {
      setConflict(true)
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

  const save = () => run((text) => trySave(wsSaveApi, nodeId, text, base))
  const overwrite = () => run((text) => tryOverwrite(wsSaveApi, nodeId, text))

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
    setDraftText(null)
    setConflict(false)
    onSaved(result.revision)
    return true
  }

  return { saved, draft, dirty, restored, startDraft, setDraft, discard, save, conflict, reload, overwrite, busy, error }
}
