import { describe, it, expect, vi } from 'vitest'
import { EDIT_STUB_MESSAGE, capabilities, normalizeProps, resolveLayers } from './viewerModel'

describe('capabilities', () => {
  it('view/full: settings but no highlighting', () => {
    expect(capabilities('view', 'full')).toEqual({
      selection: true, highlight: false, highlightPopover: false, settingsMenu: true,
      layers: true, editStub: false,
    })
  })
  it('annotate/full: highlighting and popover', () => {
    expect(capabilities('annotate', 'full')).toMatchObject({ highlight: true, highlightPopover: true, settingsMenu: true, layers: true })
  })
  it('edit/full: stub shown, no highlighting', () => {
    expect(capabilities('edit', 'full')).toMatchObject({ editStub: true, highlight: false, highlightPopover: false })
  })
  it('embedded: no settings, no highlighting, no layers, regardless of interaction', () => {
    for (const i of ['view', 'annotate', 'edit'] as const) {
      expect(capabilities(i, 'embedded')).toMatchObject({ settingsMenu: false, highlight: false, highlightPopover: false, layers: false })
    }
  })
})

describe('interaction matrix', () => {
  it('view never allows highlighting; only annotate/full does', () => {
    const rows = (['view', 'annotate', 'edit'] as const).flatMap((i) => (['full', 'embedded'] as const).map((c) => [i, c, capabilities(i, c).highlight] as const))
    expect(rows.filter((r) => r[2]).map((r) => `${r[0]}/${r[1]}`)).toEqual(['annotate/full'])
  })
  it('edit shows the stub message and keeps selection (read-only content)', () => {
    expect(capabilities('edit', 'full').selection).toBe(true)
    expect(EDIT_STUB_MESSAGE).toBe('Editing arrives in a later release')
  })
})

describe('normalizeProps', () => {
  it('defaults to annotate/full with no layers', () => {
    expect(normalizeProps({})).toEqual({ interaction: 'annotate', chrome: 'full', layers: [] })
  })
  it('passes new props through', () => {
    const layers = [{ markers: [{ id: 'a', offset: 1 }] }]
    expect(normalizeProps({ interaction: 'view', chrome: 'embedded', layers })).toEqual({ interaction: 'view', chrome: 'embedded', layers })
  })
  it('maps legacy full', () => {
    const jump = vi.fn()
    const n = normalizeProps({ mode: 'full', anchor: { start: 1, end: 2 }, markers: [{ id: 'q', offset: 3 }], onJumpToQuestion: jump })
    expect(n.interaction).toBe('annotate')
    expect(n.chrome).toBe('full')
    expect(n.layers).toHaveLength(1)
    expect(n.layers[0].anchor).toEqual({ start: 1, end: 2 })
    expect(n.layers[0].markers).toEqual([{ id: 'q', offset: 3 }])
    n.layers[0].onMarkerActivate?.('q')
    expect(jump).toHaveBeenCalledWith('q')
  })
  it('maps legacy simple', () => {
    const n = normalizeProps({ mode: 'simple' })
    expect(n.interaction).toBe('view')
    expect(n.chrome).toBe('embedded')
    expect(n.layers).toEqual([])
  })
  it('appends legacy layer after explicit layers', () => {
    const own = { markers: [{ id: 'x', offset: 0 }] }
    const n = normalizeProps({ layers: [own], markers: [{ id: 'y', offset: 5 }] })
    expect(n.layers).toHaveLength(2)
    expect(n.layers[0]).toBe(own)
  })
})

describe('resolveLayers', () => {
  it('merges markers and anchors of every layer; activation routes to the owning layer', () => {
    const a = vi.fn(), b = vi.fn()
    const r = resolveLayers([
      { anchor: { start: 0, end: 3 }, markers: [{ id: 'm', offset: 1 }], onMarkerActivate: a },
      { anchor: null, markers: [{ id: 'm', offset: 9 }], onMarkerActivate: b },
      { anchor: { start: 5, end: 8 } },
    ])
    expect(r.anchors).toEqual([{ start: 0, end: 3 }, { start: 5, end: 8 }])
    expect(r.markers.map((m) => m.offset)).toEqual([1, 9])
    r.markers[1].activate()
    expect(b).toHaveBeenCalledWith('m')
    expect(a).not.toHaveBeenCalled()
  })
})
