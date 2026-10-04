import { WsError, type AppearsInRow, type ArchivedPlacement, type NodeKind, type NodeSummary, type RestoreOutcome } from './wsApi'

// The words and the small models of the Archive view and of Delete…, kept apart
// from the components so they are tested. Vocabulary (Ben's): "Remove from X"
// takes one placement away, "Delete…" archives the node everywhere, the place
// deleted things go is the Archive, and Restore asks which placements come back.

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

// Where a node with no place shows up: a file or a folder is unplaced, and a
// trajectory, track or course is simply at the top level.
const isLoose = (kind: NodeKind): boolean => kind === 'file' || kind === 'folder'

// ---- the restore checklist -----------------------------------------------------

// One line of the checklist: a placement the node had when it was deleted.
// `when` is whether it can come back at once (its container is live: 'now') or
// has to wait (its container is still archived: 'later'). A pending one stays
// marked and is revived by restoring that container, so choosing it is not lost.
export interface RestoreChoice {
  placementId: string
  name: string
  container: { id: string; kind: NodeKind; title: string }
  when: 'now' | 'later'
  note: string | null
}

export function restoreChoices(placements: ArchivedPlacement[]): RestoreChoice[] {
  return placements.map((p) => ({
    placementId: p.placement_id,
    name: p.name,
    container: { id: p.container.id, kind: p.container.kind, title: p.container.title },
    when: p.container.archived ? 'later' : 'now',
    note: p.container.archived ? `comes back when "${p.container.title}" is restored` : null,
  }))
}

// Every box starts ticked, because Restore forgets what is not chosen for good:
// leaving a place out is something to do on purpose.
export const chosenByDefault = (choices: RestoreChoice[]): string[] => choices.map((c) => c.placementId)

// What pressing Restore will do with this choice, shown under the checklist.
export function restoreSummary(choices: RestoreChoice[], chosen: string[], kind: NodeKind): string {
  const loose = isLoose(kind) ? 'unplaced' : 'at the top level'
  if (choices.length === 0) return `It has no former places, so it comes back ${loose}.`
  const picked = choices.filter((c) => chosen.includes(c.placementId))
  const now = picked.filter((c) => c.when === 'now').length
  const later = picked.length - now
  const dropped = choices.length - picked.length
  const parts: string[] = []
  if (picked.length === 0) parts.push(`Nothing chosen: it comes back ${loose}.`)
  else if (now > 0) parts.push(`Back in ${plural(now, 'place')} now.`)
  else parts.push(`${loose.charAt(0).toUpperCase()}${loose.slice(1)} for now.`)
  if (later > 0) parts.push(waits(later))
  if (dropped > 0) parts.push(`${plural(dropped, 'unchosen place')} ${dropped === 1 ? 'is' : 'are'} forgotten.`)
  return parts.join(' ')
}

const waits = (n: number): string => `${plural(n, 'place')} ${n === 1 ? 'waits' : 'wait'} for ${n === 1 ? 'its container' : 'their containers'} to be restored.`

// ---- after restoring ---------------------------------------------------------

// Restore: say so, and when a name had been taken in the meantime, what it is
// called now (the server gives the new names, not where they are); which
// placements are waiting for a container that is still archived; and where to
// find the node when it came back with no place at all.
export function restoreNotice(node: { title: string; kind: NodeKind }, out: RestoreOutcome): string {
  const renamed = out.placements.filter((p) => p.renamed).map((p) => `"${p.name}"`)
  let text = `Restored "${node.title}".`
  if (renamed.length === 1) text += ` A name was already taken in 1 place, so it is called ${renamed[0]} there.`
  else if (renamed.length > 1) text += ` A name was already taken in ${renamed.length} places, so its names there are ${renamed.join(', ')}.`
  if (out.skipped.length > 0) text += ` ${waits(out.skipped.length)}`
  if (out.placements.length === 0) {
    text += isLoose(node.kind) ? ' It is unplaced: find it in the picker, under Unplaced.' : ' It is at the top level: find it in the picker.'
  }
  return text
}

// What else was deleted by the same call, as an offer to restore it too.
export const matesOffer = (mates: NodeSummary[]): string => `Also restore ${mates.length} deleted with it`

// After "restore them too": how many came back (with each one's own outcome
// summed, so a long list is still one line) and which could not.
export function matesNotice(done: { title: string; out: RestoreOutcome }[], failed: { title: string; message: string }[]): string {
  const parts: string[] = []
  if (done.length > 0) {
    parts.push(`Restored ${done.length} more: ${done.map((d) => `"${d.title}"`).join(', ')}.`)
    const renamed = done.reduce((n, d) => n + d.out.placements.filter((p) => p.renamed).length, 0)
    if (renamed > 0) parts.push(`A name was taken in ${plural(renamed, 'place')}, so ${renamed === 1 ? 'it was' : 'they were'} renamed.`)
    const skipped = done.reduce((n, d) => n + d.out.skipped.length, 0)
    if (skipped > 0) parts.push(waits(skipped))
  }
  for (const f of failed) parts.push(`Could not restore "${f.title}": ${f.message}`)
  return parts.join(' ')
}

// ---- purge -------------------------------------------------------------------

// Why a purge was refused. An upload's file in the workspace goes when the
// upload does, and the server refuses to purge it while the upload exists
// (asset_in_use); that one gets the way out. The rest are the server's words.
export function purgeProblem(err: unknown, title: string): string {
  if (err instanceof WsError && err.code === 'asset_in_use') {
    return `"${title}" is an upload that still exists, so it cannot be purged here. Delete the upload in Settings → Documents, then purge it.`
  }
  return err instanceof Error ? err.message : String(err)
}

// The confirm's text for Purge.
export function purgeBody(kind: NodeKind): string {
  const loses =
    kind === 'file'
      ? 'Its content and every saved version go with it.'
      : 'Items placed only in it become unplaced; nothing else is touched.'
  return `This deletes it permanently and it cannot be undone. ${loses}`
}

// ---- remove from, and delete ----------------------------------------------------

// Remove from …: one placement is gone (trash) and nothing is archived. When it
// was the node's last place the node is not lost, and the notice says where it
// is now.
export function removeNotice(name: string, from: string, kind: NodeKind, becameUnplaced: boolean): string {
  const removed = `Removed "${name}" from "${from}".`
  if (!becameUnplaced) return removed
  return isLoose(kind)
    ? `${removed} It is not placed anywhere now. It is still in the picker, under Unplaced.`
    : `${removed} It is at the top level now. It is still in the picker.`
}

// The Delete… dialog's text: where the node appears (deleting it takes it out of
// all of those, which is the difference from removing it from one), and, when
// there are items placed only inside it (the orphans the preview counted), what
// happens to them.
export function deleteBody(kind: NodeKind, appearsIn: AppearsInRow[], orphans: number): string {
  const where =
    appearsIn.length === 0
      ? 'It is not placed anywhere.'
      : `It goes to the Archive, so it disappears from every place it appears:\n${appearsIn.map((a) => `  • ${a.container.title}, as "${a.name}"`).join('\n')}`
  if (kind === 'file' || orphans === 0) return where
  return `${where}\nItems placed only inside it are left without a place, unless you delete them with it.`
}

export const orphanLabel = (n: number): string => `Also delete ${plural(n, 'item')} placed nowhere else`

export function deleteNotice(name: string, archivedCount: number): string {
  const more = archivedCount > 1 ? ` with ${archivedCount - 1} more` : ''
  return `"${name}" is in the Archive${more}. Restore it from Archive in the picker (Switch).`
}
