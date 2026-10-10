import type { ToolbarCommand } from 'engine-host'
import type { Chrome, Interaction } from './types'
import type { ZoomMode } from './zoomModel'

export interface CommandState {
  interaction: Interaction
  chrome: Chrome
  // Current zoom mode (a fit mode or a number) and whether fit modes apply.
  zoom: ZoomMode
  allowFit: boolean
  atMin: boolean
  atMax: boolean
  showOverlays: boolean
  // The current selection touches an existing highlight.
  canRemoveHighlight: boolean
  canDownload: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: (mode: 'fit-width' | 'fit-page' | 'fit-height') => void
  onToggleOverlays: () => void
  onRemoveHighlight: () => void
  onDownload: () => void
}

// What the viewer offers the host's toolbar. 'view' and embedded viewers
// offer nothing; 'edit' offers zoom and download only (the editor adds its own).
export function buildCommands(s: CommandState): ToolbarCommand[] {
  if (s.interaction === 'view' || s.chrome === 'embedded') return []
  const cmds: ToolbarCommand[] = [
    { id: 'zoom-in', label: 'Zoom in', icon: 'doc-zoom-in', group: 'view', enabled: !s.atMax, active: false, run: s.onZoomIn },
    { id: 'zoom-out', label: 'Zoom out', icon: 'doc-zoom-out', group: 'view', enabled: !s.atMin, active: false, run: s.onZoomOut },
  ]
  if (s.allowFit) {
    const fits = [
      ['fit-width', 'Fit width'],
      ['fit-page', 'Fit page'],
      ['fit-height', 'Fit height'],
    ] as const
    for (const [mode, label] of fits) {
      cmds.push({ id: `zoom-${mode}`, label, icon: 'doc-fit', group: 'view', enabled: true, active: s.zoom === mode, run: () => s.onFit(mode) })
    }
  }
  if (s.interaction === 'annotate') {
    cmds.push(
      {
        id: 'highlights-toggle',
        label: s.showOverlays ? 'Hide highlights' : 'Show highlights',
        icon: s.showOverlays ? 'doc-eye' : 'doc-eye-off',
        group: 'annotate',
        enabled: true,
        active: s.showOverlays,
        run: s.onToggleOverlays,
      },
      { id: 'highlight-remove', label: 'Remove highlight', icon: 'doc-highlight-remove', group: 'annotate', enabled: s.canRemoveHighlight, active: false, run: s.onRemoveHighlight }
    )
  }
  if (s.canDownload) {
    cmds.push({ id: 'download', label: 'Download', icon: 'doc-download', group: 'file', enabled: true, active: false, run: s.onDownload })
  }
  return cmds
}

// The part of a command list that matters for republishing: run() is not in it.
export function commandsShape(cmds: ToolbarCommand[]): string {
  return JSON.stringify(cmds.map((c) => [c.id, c.label, c.icon, c.enabled, c.active]))
}
