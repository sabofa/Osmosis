import { describe, it, expect, vi } from 'vitest'
import { buildCommands, commandsShape, type CommandState } from './commands'
import { ICON_NAMES } from './iconSheet'
import { buildEditorRibbon } from './ribbon/ribbonState'
import { ribbonToToolbarCommands } from './ribbon/ribbonModel'

const buildEditorCommands = (view: null) => ribbonToToolbarCommands(buildEditorRibbon(view))

function state(over: Partial<CommandState> = {}): CommandState {
  return {
    interaction: 'annotate',
    chrome: 'full',
    zoom: 'fit-width',
    allowFit: true,
    atMin: false,
    atMax: false,
    showOverlays: true,
    canRemoveHighlight: false,
    canDownload: true,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFit: vi.fn(),
    onToggleOverlays: vi.fn(),
    onRemoveHighlight: vi.fn(),
    onDownload: vi.fn(),
    ...over,
  }
}
const ids = (s: CommandState) => buildCommands(s).map((c) => c.id)

describe('buildCommands matrix', () => {
  it('embedded offers nothing; view offers zoom and download only', () => {
    expect(ids(state({ interaction: 'view' }))).toEqual(['zoom-in', 'zoom-out', 'zoom-fit-width', 'zoom-fit-page', 'zoom-fit-height', 'download'])
    expect(ids(state({ interaction: 'view', allowFit: false, canDownload: false }))).toEqual(['zoom-in', 'zoom-out'])
    for (const c of buildCommands(state({ interaction: 'view' }))) expect(['view', 'file']).toContain(c.group)
    expect(buildCommands(state({ chrome: 'embedded' }))).toEqual([])
    expect(buildCommands(state({ interaction: 'view', chrome: 'embedded' }))).toEqual([])
    expect(buildCommands(state({ interaction: 'edit', chrome: 'embedded' }))).toEqual([])
  })
  it('annotate groups: zoom in view, highlights in annotate, download in file', () => {
    const g = Object.fromEntries(buildCommands(state()).map((c) => [c.id, c.group]))
    expect(g).toMatchObject({ 'zoom-in': 'view', 'zoom-fit-page': 'view', 'highlights-toggle': 'annotate', 'highlight-remove': 'annotate', download: 'file' })
  })
  it('annotate offers everything', () => {
    expect(ids(state())).toEqual([
      'zoom-in', 'zoom-out', 'zoom-fit-width', 'zoom-fit-page', 'zoom-fit-height', 'highlights-toggle', 'highlight-remove', 'download',
    ])
  })
  it('edit offers only zoom and download', () => {
    expect(ids(state({ interaction: 'edit' }))).toEqual(['zoom-in', 'zoom-out', 'zoom-fit-width', 'zoom-fit-page', 'zoom-fit-height', 'download'])
  })
  it('edit over a text editor offers the editor commands and download, no zoom or graph', () => {
    const editorCommands = buildEditorCommands(null)
    const s = state({ interaction: 'edit', editorCommands, graph: { canExpand: true, canCollapse: false, onExpand: vi.fn(), onCollapse: vi.fn() } })
    expect(ids(s)).toEqual([...editorCommands.map((c) => c.id), 'download'])
    expect(ids(state({ interaction: 'edit', editorCommands, canDownload: false }))).toEqual(editorCommands.map((c) => c.id))
    for (const c of buildCommands(s)) expect(ICON_NAMES as readonly string[]).toContain(c.icon)
    expect(new Set(ids(s)).size).toBe(ids(s).length)
  })
  it('editor commands are ignored outside edit, and null keeps the zoom set', () => {
    expect(ids(state({ editorCommands: buildEditorCommands(null) }))).toEqual(ids(state()))
    expect(ids(state({ interaction: 'edit', editorCommands: null }))).toEqual(['zoom-in', 'zoom-out', 'zoom-fit-width', 'zoom-fit-page', 'zoom-fit-height', 'download'])
  })
  it('fit modes only when they apply; download only when one exists', () => {
    expect(ids(state({ allowFit: false, canDownload: false }))).toEqual(['zoom-in', 'zoom-out', 'highlights-toggle', 'highlight-remove'])
  })
  it('only uses known icon names and unique ids', () => {
    const cmds = buildCommands(state())
    for (const c of cmds) expect(ICON_NAMES as readonly string[]).toContain(c.icon)
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length)
    const hidden = buildCommands(state({ showOverlays: false }))
    for (const c of hidden) expect(ICON_NAMES as readonly string[]).toContain(c.icon)
  })
})

describe('enabled / active flags', () => {
  const get = (s: CommandState, id: string) => buildCommands(s).find((c) => c.id === id)!
  it('zoom limits disable the matching button', () => {
    expect(get(state({ atMax: true }), 'zoom-in').enabled).toBe(false)
    expect(get(state({ atMax: true }), 'zoom-out').enabled).toBe(true)
    expect(get(state({ atMin: true }), 'zoom-out').enabled).toBe(false)
  })
  it('the current fit mode is active', () => {
    expect(get(state({ zoom: 'fit-page' }), 'zoom-fit-page').active).toBe(true)
    expect(get(state({ zoom: 'fit-page' }), 'zoom-fit-width').active).toBe(false)
    expect(get(state({ zoom: 1 }), 'zoom-fit-page').active).toBe(false)
  })
  it('highlights toggle follows overlays; remove follows the selection', () => {
    const on = get(state(), 'highlights-toggle')
    expect(on).toMatchObject({ active: true, icon: 'doc-eye', enabled: true, group: 'annotate' })
    expect(get(state({ showOverlays: false }), 'highlights-toggle')).toMatchObject({ active: false, icon: 'doc-eye-off' })
    expect(get(state(), 'highlight-remove').enabled).toBe(false)
    expect(get(state({ canRemoveHighlight: true }), 'highlight-remove').enabled).toBe(true)
  })
})

describe('run', () => {
  it('calls the callbacks', () => {
    const s = state()
    const run = (id: string) => buildCommands(s).find((c) => c.id === id)!.run()
    run('zoom-in'); run('zoom-out'); run('zoom-fit-page'); run('highlights-toggle'); run('highlight-remove'); run('download')
    expect(s.onZoomIn).toHaveBeenCalledTimes(1)
    expect(s.onZoomOut).toHaveBeenCalledTimes(1)
    expect(s.onFit).toHaveBeenCalledWith('fit-page')
    expect(s.onToggleOverlays).toHaveBeenCalledTimes(1)
    expect(s.onRemoveHighlight).toHaveBeenCalledTimes(1)
    expect(s.onDownload).toHaveBeenCalledTimes(1)
  })
})

describe('commandsShape', () => {
  it('ignores run identity, tracks enabled/active', () => {
    expect(commandsShape(buildCommands(state()))).toBe(commandsShape(buildCommands(state())))
    expect(commandsShape(buildCommands(state()))).not.toBe(commandsShape(buildCommands(state({ canRemoveHighlight: true }))))
  })
})

describe('graph commands', () => {
  const graph = (over = {}) => ({ canExpand: true, canCollapse: false, onExpand: vi.fn(), onCollapse: vi.fn(), ...over })
  const get = (s: CommandState, id: string) => buildCommands(s).find((c) => c.id === id)
  it('published in annotate and edit when graph state exists, with known icons', () => {
    for (const interaction of ['annotate', 'edit'] as const) {
      const cmds = buildCommands(state({ interaction, graph: graph() }))
      expect(cmds.map((c) => c.id)).toContain('graph-expand')
      expect(cmds.map((c) => c.id)).toContain('graph-collapse')
      for (const c of cmds) expect(ICON_NAMES as readonly string[]).toContain(c.icon)
      expect(get(state({ interaction, graph: graph() }), 'graph-expand')).toMatchObject({ label: 'Graph: Expand', icon: 'graph-expand', group: 'graph' })
      expect(get(state({ interaction, graph: graph() }), 'graph-collapse')).toMatchObject({ label: 'Graph: Collapse', icon: 'graph-collapse', group: 'graph' })
    }
  })
  it('absent without graph state, in view, and embedded', () => {
    expect(ids(state())).not.toContain('graph-expand')
    expect(ids(state({ graph: null }))).not.toContain('graph-collapse')
    expect(ids(state({ interaction: 'view', graph: graph() }))).not.toContain('graph-expand')
    expect(buildCommands(state({ chrome: 'embedded', graph: graph() }))).toEqual([])
  })
  it('enabled flags follow the state and run calls through', () => {
    const g = graph({ canExpand: false, canCollapse: true })
    const s = state({ graph: g })
    expect(get(s, 'graph-expand')!.enabled).toBe(false)
    expect(get(s, 'graph-collapse')!.enabled).toBe(true)
    get(s, 'graph-collapse')!.run()
    expect(g.onCollapse).toHaveBeenCalled()
  })
})
