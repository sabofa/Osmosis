import type { ComponentType, ReactNode } from 'react'
import { ChartIcon, ClipboardIcon, PencilIcon } from '../components/icons'
import { AssetView, GraphView } from './BuiltinViews'
import MarkdownFile from './MarkdownFile'

// The web half of the format registry. The server half is the format hooks
// (server/src/domain/workspace/formats.ts): the data layer stores a file's
// `format` and body and never interprets either; how a format is shown is the
// shell's and the engines' business, and lives here. The centre pane reads a
// file's content, looks its format up here and renders the View. A format with
// no entry is not an error: CenterPane shows its fallback, so the server can
// hold a format the web app has not learned yet.
//
// The markdown view is the frame's placeholder: the document engine's views and
// edit mode replace it by registering the "markdown" format instead.
//
// Adding a special format (an item file, a long-lived notes file) is one
// registerWebFileType call, in a module of its own that is imported once, from
// extensions.ts (which Workspace.tsx imports). Nothing else changes: the
// "New ..." menus offer every format that has a `newBody`.

// What a View is given, once, when it mounts. After that the View owns its
// state: `onSaved` only moves `version` along in CenterPane, so `body` and
// `version` here can go stale relative to what the View has saved, and the
// View must not follow them. A format that Ben edits and the tutor or the
// planner also write should edit through useFileDraft (and show a
// ConflictBanner), which keeps the saved text, the unsaved draft, the base
// version of a save, the 409 choice (Reload, Overwrite or Merge) and the draft
// that survives a tab switch, so it cannot silently overwrite their work.
export interface FileViewProps {
  nodeId: string
  format: string
  body: string | null
  assetId: string | null
  version: number
  // Tell the frame the file was saved at this version.
  onSaved(version: number): void
}

export interface WebFileType {
  format: string
  label: string
  icon?: ReactNode
  View: ComponentType<FileViewProps>
  // Present: the "New ..." menus offer to make a file of this format, starting
  // with this body (an empty string is a body). Absent: this format is not made
  // from the menus (an upload is made by uploading, a graph by its author).
  newBody?: string
}

const registry = new Map<string, WebFileType>()

export function registerWebFileType(t: WebFileType): void {
  if (registry.has(t.format)) throw new Error(`web file format "${t.format}" is already registered`)
  registry.set(t.format, t)
}

// Null for a format nobody has registered, so the caller shows its fallback.
export function webFileType(format: string): WebFileType | null {
  return registry.get(format) ?? null
}

export function listWebFileTypes(): WebFileType[] {
  return [...registry.values()]
}

// ---- built-ins ---------------------------------------------------------------

registerWebFileType({ format: 'markdown', label: 'Markdown', icon: <PencilIcon size={14} />, View: MarkdownFile, newBody: '' })
registerWebFileType({ format: 'graph', label: 'Graph', icon: <ChartIcon size={14} />, View: GraphView })
registerWebFileType({ format: 'upload', label: 'Upload', icon: <ClipboardIcon size={14} />, View: AssetView })
