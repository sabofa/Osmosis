import type { NodeKind } from './wsApi'

// What a container can be given from the "New ..." entries. The containment
// matrix is the server's (server/src/domain/workspace/types.ts, MAY_HOLD):
// the server refuses anything else, so the menus only offer what it will take.
// Folders have no built-in meaning, they just hold folders and files.
const MAY_HOLD: Record<NodeKind, readonly NodeKind[]> = {
  trajectory: ['track', 'course', 'folder', 'file'],
  track: ['course', 'folder', 'file'],
  course: ['folder', 'file'],
  folder: ['folder', 'file'],
  file: [],
}

// Whether a container of this kind may hold a node of that kind, by the same
// matrix: the "Place in…" list offers only the containers that may hold what
// is being placed.
export const mayHold = (container: NodeKind, child: NodeKind): boolean => MAY_HOLD[container].includes(child)

// What a "New ..." entry can make. Never a trajectory: nothing holds one, so it
// is only made at the top, from the picker.
export type NewKind = 'file' | 'folder' | 'course' | 'track'

export interface NewOption {
  key: string
  kind: NewKind
  // For a file: the registered web format it is made as.
  format?: string
  // The row-menu entry, and the shorter word for a "+ ..." link.
  label: string
  short: string
}

// The entries for a container of this kind: one per registered web format that
// says how a new file starts (it has a `newBody`), then folder, course and track
// where the matrix lets this container hold them. Registering a special format
// is therefore all it takes to get a "New ..." entry for it.
export function newOptions(container: NodeKind, formats: { format: string; label: string; newBody?: string }[]): NewOption[] {
  const may = MAY_HOLD[container]
  const out: NewOption[] = []
  if (may.includes('file')) {
    const creatable = formats.filter((t) => t.newBody !== undefined)
    for (const t of creatable) {
      out.push({
        key: `file:${t.format}`,
        kind: 'file',
        format: t.format,
        // One kind of file to make reads simply as "New file".
        label: creatable.length === 1 ? 'New file' : `New ${t.label} file`,
        short: creatable.length === 1 ? 'File' : t.label,
      })
    }
  }
  if (may.includes('folder')) out.push({ key: 'folder', kind: 'folder', label: 'New folder', short: 'Folder' })
  if (may.includes('course')) out.push({ key: 'course', kind: 'course', label: 'New course', short: 'Course' })
  if (may.includes('track')) out.push({ key: 'track', kind: 'track', label: 'New track', short: 'Track' })
  return out
}
