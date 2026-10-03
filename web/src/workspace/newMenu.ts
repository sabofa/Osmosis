import type { NodeKind } from './wsApi'

// What a container can be given from the "New ..." entries. The containment
// matrix is the server's (server/src/domain/workspace/types.ts, MAY_HOLD):
// the server refuses anything else, so the menus only offer what it will take.
const MAY_HOLD: Record<NodeKind, readonly NodeKind[]> = {
  track: ['track', 'course', 'folder', 'file'],
  course: ['folder', 'file'],
  folder: ['course', 'folder', 'file'],
  file: [],
}

// Whether a container of this kind may hold a node of that kind, by the same
// matrix: the "Place in…" list offers only the containers that may hold what
// is being placed.
export const mayHold = (container: NodeKind, child: NodeKind): boolean => MAY_HOLD[container].includes(child)

export type NewKind = 'file' | 'folder' | 'course' | 'track'

export interface NewOption {
  key: string
  kind: NewKind
  // For a file: the registered web file type it is made as.
  fileType?: string
  // The row-menu entry, and the shorter word for a "+ ..." link.
  label: string
  short: string
}

// The entries for a container of this kind: one per registered web file type
// that says how a new one starts (it has a `newBody`), then folder, course and
// track where the matrix lets this container hold them. Registering a special
// file type is therefore all it takes to get a "New ..." entry for it.
export function newOptions(container: NodeKind, types: { type: string; label: string; newBody?: string }[]): NewOption[] {
  const may = MAY_HOLD[container]
  const out: NewOption[] = []
  if (may.includes('file')) {
    const creatable = types.filter((t) => t.newBody !== undefined)
    for (const t of creatable) {
      out.push({
        key: `file:${t.type}`,
        kind: 'file',
        fileType: t.type,
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
