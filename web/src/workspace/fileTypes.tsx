import type { ComponentType, ReactNode } from 'react'
import { ChartIcon, ClipboardIcon, PencilIcon } from '../components/icons'
import { AssetView, GraphView } from './BuiltinViews'
import MarkdownFile from './MarkdownFile'

// The web half of the file-type registry (the server half is
// server/src/domain/workspace/fileTypes.ts). The centre pane reads a file's
// content, looks its type up here, and renders the View. A type with no
// entry is not an error: CenterPane shows its fallback, so the server can
// know a type the web app has not learned yet.
//
// Adding a special type (an item file, a long-lived notes file) is one
// registerWebFileType call, in a module of its own that is imported once, from
// extensions.ts (which Workspace.tsx imports). Nothing else changes: the
// "New ..." menus offer every type that has a `newBody`.

// What a View is given, once, when it mounts. After that the View owns its
// state: `onSaved` only moves `revision` along in CenterPane, so `body` and
// `revision` here can go stale relative to what the View has saved, and the
// View must not follow them. A type that Ben edits and the tutor or the planner
// also write should edit through useFileDraft (and show a ConflictBanner),
// which keeps the saved text, the unsaved draft, the base revision of a save,
// the 409 choice (Reload or Overwrite) and the draft that survives a tab
// switch, so it cannot silently overwrite their work.
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
  // Present: the "New ..." menus offer to make a file of this type, starting
  // with this body (an empty string is a body). Absent: this type is not made
  // from the menus (an upload is made by uploading, a graph by its author).
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
