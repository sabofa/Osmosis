import { webFileType } from './fileTypes'
import type { NewKind } from './newMenu'
import { createNode } from './wsApi'

// Asks for a name and makes a file, folder, course or track inside a
// container. A file is made as the given registered web type (markdown by
// default), starting with the body that type says a new one starts with. The
// containment matrix is the server's to enforce; callers offer only what
// newOptions says the container may hold. Null when the name was left empty or
// the prompt cancelled.
export async function createUnder(
  containerId: string,
  kind: NewKind,
  fileType = 'markdown'
): Promise<{ id: string; title: string } | null> {
  const title = window.prompt(`Name for the new ${kind}`)
  if (title === null || title.trim() === '') return null
  const made = await createNode({
    kind,
    title,
    file: kind === 'file' ? { type: fileType, body: webFileType(fileType)?.newBody ?? '' } : undefined,
    placeIn: containerId,
  })
  return { id: made.node.id, title: made.placement?.name ?? made.node.title }
}
