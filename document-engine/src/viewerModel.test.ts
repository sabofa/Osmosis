import { describe, it, expect, vi } from 'vitest'
import { EDIT_STUB_MESSAGE, capabilities, gatedPresentation, offsetText, awaitingPdfText, resolveLayers } from './viewerModel'

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

describe('gatedPresentation', () => {
  it('open: content exposed, no placeholder', () => {
    expect(gatedPresentation(false)).toEqual({ gated: false, contentHidden: false, placeholder: null })
    expect(gatedPresentation(undefined, 'x').placeholder).toBeNull()
  })
  it('gated: content hidden from the accessibility tree, default label', () => {
    expect(gatedPresentation(true)).toEqual({ gated: true, contentHidden: true, placeholder: 'Hidden' })
  })
  it('gated: custom label, blank falls back to default', () => {
    expect(gatedPresentation(true, 'Locked').placeholder).toBe('Locked')
    expect(gatedPresentation(true, '  ').placeholder).toBe('Hidden')
  })
  it('is a pure presentation function: it carries no zoom or scroll values', () => {
    const keys = Object.keys(gatedPresentation(true))
    expect(keys).not.toContain('zoom')
    expect(keys.some((k) => /scroll/i.test(k))).toBe(false)
    expect(gatedPresentation(true)).toEqual(gatedPresentation(true))
  })
})

describe('offsetText', () => {
  it('uses the PDF layer text once loaded, even when extractedText is empty', () => {
    expect(offsetText(true, 'pdf words', '')).toBe('pdf words')
  })
  it('never falls back to the asset text while a PDF layer awaits its text', () => {
    expect(offsetText(true, '', 'asset')).toBe('')
    expect(awaitingPdfText(true, '')).toBe(true)
    expect(awaitingPdfText(true, 'x')).toBe(false)
    expect(awaitingPdfText(false, '')).toBe(false)
  })
  it('non-PDF text uses the asset text', () => {
    expect(offsetText(false, 'pdf words', 'asset')).toBe('asset')
  })
})

describe('resolveLayers activation', () => {
  it('reads the current layer callback at activation time', () => {
    const first = vi.fn()
    const second = vi.fn()
    let current = [{ markers: [{ id: 'm', offset: 0 }], onMarkerActivate: first }]
    const { markers } = resolveLayers(current, () => current)
    current = [{ markers: [{ id: 'm', offset: 0 }], onMarkerActivate: second }]
    markers[0].activate()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('m')
  })
})
