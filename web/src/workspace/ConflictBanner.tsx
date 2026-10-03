// What a file view shows when useFileDraft reports a conflict: the file moved
// on (the tutor or the planner wrote to it) since Ben opened it. Reload takes
// their version and drops his edit; Overwrite reads where the file is now and
// puts his on top. When all that happened is that text was added at the end
// (`addition`: the tutor's notes in USERNOTES), Merge keeps both: his text
// followed by theirs. Nothing is written until he picks one.
const PREVIEW_CHARS = 240

export default function ConflictBanner({
  busy,
  addition,
  onReload,
  onOverwrite,
  onMerge,
}: {
  busy: boolean
  addition?: string | null
  onReload(): void
  onOverwrite(): void
  onMerge?: () => void
}) {
  const canMerge = !!addition && !!onMerge
  const preview = addition ? addition.trim() : ''
  return (
    <div className="ws-conflict" role="alert">
      <span>
        {canMerge
          ? 'Changed elsewhere — text was added to the end of the file since you opened it.'
          : 'Changed elsewhere — the file moved on since you opened it.'}
      </span>
      {canMerge && (
        <button className="ws-btn primary" disabled={busy} onClick={onMerge}>
          Merge their additions
        </button>
      )}
      <button className="ws-btn" disabled={busy} onClick={onReload}>
        Reload
      </button>
      <button className="ws-btn danger" disabled={busy} onClick={onOverwrite}>
        Overwrite
      </button>
      {canMerge && preview && (
        <div className="ws-conflict-added" title="What was added">
          {preview.length > PREVIEW_CHARS ? `${preview.slice(0, PREVIEW_CHARS)}…` : preview}
        </div>
      )}
    </div>
  )
}
