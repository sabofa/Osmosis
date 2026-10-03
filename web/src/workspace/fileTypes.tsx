import type { ComponentType, ReactNode } from 'react'
import { ChartIcon, ClipboardIcon, PencilIcon } from '../components/icons'
import { AssetView, GraphView } from './BuiltinViews'
import MarkdownFile from './MarkdownFile'

// The web half of the file-type registry (the server half is
// server/src/domain/workspace/fileTypes.ts). The centre pane reads a file's
// content, looks its type up here, and renders the View. A type with no
// entry is not an error: CenterPane shows its fallback, so the server can
// know a type the web app has not learned yet. A new special type (an item
// file, a long-lived notes file) is one registerWebFileType call.

export interface FileViewProps {
  nodeId: string
  type: string
  body: string | null
  assetId: string | null
  revision: number
  // Tell the frame the file was saved at this revision.
  onSaved(revision: number): void
}

export interface WebFileType {
  type: string
  label: string
  icon?: ReactNode
  View: ComponentType<FileViewProps>
  // What "New file" starts a file of this type with. Absent: an empty body.
  newBody?: string
}

const registry = new Map<string, WebFileType>()

export function registerWebFileType(t: WebFileType): void {
  if (registry.has(t.type)) throw new Error(`web file type "${t.type}" is already registered`)
  registry.set(t.type, t)
}

// Null for a type nobody has registered, so the caller shows its fallback.
export function webFileType(type: string): WebFileType | null {
  return registry.get(type) ?? null
}

export function listWebFileTypes(): WebFileType[] {
  return [...registry.values()]
}

// ---- built-ins ---------------------------------------------------------------

registerWebFileType({ type: 'markdown', label: 'Markdown', icon: <PencilIcon size={14} />, View: MarkdownFile, newBody: '' })
registerWebFileType({ type: 'graph', label: 'Graph', icon: <ChartIcon size={14} />, View: GraphView })
registerWebFileType({ type: 'asset', label: 'Upload', icon: <ClipboardIcon size={14} />, View: AssetView })
