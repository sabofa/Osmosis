import { webFileType } from './fileTypes'
import { createNode } from './wsApi'

// Asks for a name and makes a markdown file or a folder inside a container.
// Null when the name was left empty or the prompt cancelled.
export async function createUnder(containerId: string, kind: 'file' | 'folder'): Promise<{ id: string; title: string } | null> {
  const title = window.prompt(kind === 'file' ? 'Name for the new file' : 'Name for the new folder')
  if (title === null || title.trim() === '') return null
  const made = await createNode({
    kind,
    title,
    file: kind === 'file' ? { type: 'markdown', body: webFileType('markdown')?.newBody ?? '' } : undefined,
    placeIn: containerId,
  })
  return { id: made.node.id, title: made.placement?.name ?? made.node.title }
}
