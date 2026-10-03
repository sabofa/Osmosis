// What a file view shows when useFileDraft reports a conflict: the file moved
// on (the tutor or the planner wrote to it) since Ben opened it. Reload takes
// their version and drops his edit; Overwrite reads where the file is now and
// puts his on top. Nothing is written until he picks one.
export default function ConflictBanner({ busy, onReload, onOverwrite }: { busy: boolean; onReload(): void; onOverwrite(): void }) {
  return (
    <div className="ws-conflict" role="alert">
      <span>Changed elsewhere — the file moved on since you opened it.</span>
      <button className="ws-btn" disabled={busy} onClick={onReload}>
        Reload
      </button>
      <button className="ws-btn danger" disabled={busy} onClick={onOverwrite}>
        Overwrite
      </button>
    </div>
  )
}
