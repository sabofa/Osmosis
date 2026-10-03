import { WsError, type NodeKind } from './wsApi'

// The words of the trash view, kept apart from the component so they are tested.

// Restore: say so, and when a name had been taken in the meantime, what it is
// called now (the server gives the new names, not where they are).
export function restoreNotice(title: string, renamed: { placement_id: string; name: string }[]): string {
  if (renamed.length === 0) return `Restored "${title}".`
  const names = renamed.map((r) => `"${r.name}"`).join(', ')
  if (renamed.length === 1) return `Restored "${title}". A name was already taken in 1 place, so it is called ${names} there.`
  return `Restored "${title}". A name was already taken in ${renamed.length} places, so its names there are ${names}.`
}

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
      ? 'Its content and every saved revision go with it.'
      : 'Items placed only in it become unplaced; nothing else is touched.'
  return `This deletes it permanently and it cannot be undone. ${loses}`
}
