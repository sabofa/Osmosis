import { describe, it, expect, vi } from 'vitest'
import { buildCommands, commandsShape, type CommandState } from './commands'
import { ICON_NAMES } from './iconSheet'

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
  it('view and embedded offer nothing', () => {
    expect(buildCommands(state({ interaction: 'view' }))).toEqual([])
    expect(buildCommands(state({ chrome: 'embedded' }))).toEqual([])
    expect(buildCommands(state({ interaction: 'edit', chrome: 'embedded' }))).toEqual([])
  })
  it('annotate offers everything', () => {
    expect(ids(state())).toEqual([
      'zoom-in', 'zoom-out', 'zoom-fit-width', 'zoom-fit-page', 'zoom-fit-height', 'highlights-toggle', 'highlight-remove', 'download',
    ])
  })
  it('edit offers only zoom and download', () => {
    expect(ids(state({ interaction: 'edit' }))).toEqual(['zoom-in', 'zoom-out', 'zoom-fit-width', 'zoom-fit-page', 'zoom-fit-height', 'download'])
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
