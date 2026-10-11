// The editor's command row for an unhosted viewer (no host toolbar to draw
// the commands). Same ToolbarCommand list the host would get.
import type { ToolbarCommand } from 'engine-host'
import type { IconSheetRef } from 'theme-core'
import { resolveIcon } from '../iconSheet'

export interface EditorCommandBarProps {
  commands: ToolbarCommand[]
  icons: IconSheetRef
}

export default function EditorCommandBar({ commands, icons }: EditorCommandBarProps) {
  let lastGroup: string | null = null
  return (
    <div className="document-viewer-editor-bar" role="toolbar" aria-label="Formatting" data-component="tool-row">
      {commands.map((c) => {
        const Icon = resolveIcon(c.icon, icons)
        const sep = lastGroup !== null && lastGroup !== c.group
        lastGroup = c.group
        return (
          <span key={c.id} className="document-viewer-editor-bar-item">
            {sep && <span className="document-viewer-editor-bar-sep" aria-hidden="true" />}
            <button
              type="button"
              data-component="pill"
              className="document-viewer-editor-bar-btn"
              title={c.shortcut ? `${c.label} (${c.shortcut.replace('Mod', 'Ctrl')})` : c.label}
              aria-label={c.label}
              aria-pressed={c.active}
              disabled={!c.enabled}
              // Keep the editor's selection and focus while clicking.
              onMouseDown={(e) => e.preventDefault()}
              onClick={c.run}
            >
              <Icon size={15} />
            </button>
          </span>
        )
      })}
    </div>
  )
}
