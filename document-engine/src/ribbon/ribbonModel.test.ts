import { describe, it, expect, vi } from 'vitest'
import { ICON_NAMES } from '../iconSheet'
import {
  buildRibbon, flattenRibbon, ribbonControls, ribbonToToolbarCommands, FONT_SIZE_MAX, FONT_SIZE_MIN,
  type RibbonState, type RibbonHandlers, type RibbonMode, type RibbonControl, type RibbonGallery, type RibbonSelect,
} from './ribbonModel'
import type { ActiveMarks } from '../editor/editorCommands'

const NO_MARKS: ActiveMarks = { bold: false, italic: false, strike: false, code: false, heading: false, bullet: false, numbered: false, task: false, quote: false }
const baseState = (over: Partial<RibbonState> = {}): RibbonState => ({
  marks: NO_MARKS, blockStyle: 'normal', selectionEmpty: false, undoDepth: 2, redoDepth: 1, readOnly: false, clipboard: true, ...over,
})
const mkHandlers = () => ({ command: vi.fn(), blockStyle: vi.fn(), setValue: vi.fn() }) satisfies RibbonHandlers
const build = (mode: RibbonMode, over: Partial<RibbonState> = {}, h: RibbonHandlers = mkHandlers()) =>
  buildRibbon({ mode, state: baseState(over), handlers: h })
const byId = (r: ReturnType<typeof build>, id: string): RibbonControl => {
  const c = ribbonControls(r).find((i) => i.id === id)
  if (!c) throw new Error('no item ' + id)
  return c
}
const groupIds = (r: ReturnType<typeof build>, tab: string) => r.tabs.find((t) => t.id === tab)!.groups.map((g) => g.id)
const itemIds = (r: ReturnType<typeof build>, tab: string, group: string) =>
  r.tabs.find((t) => t.id === tab)!.groups.find((g) => g.id === group)!.items.filter((i) => i.kind !== 'separator').map((i) => i.id)

describe('buildRibbon layout', () => {
  it('markdown: Home and Insert with the specified groups', () => {
    const r = build('markdown')
    expect(r.tabs.map((t) => t.id)).toEqual(['home', 'insert'])
    expect(groupIds(r, 'home')).toEqual(['clipboard', 'font', 'paragraph', 'styles', 'editing', 'history'])
    expect(itemIds(r, 'home', 'clipboard')).toEqual(['paste', 'cut', 'copy'])
    expect(itemIds(r, 'home', 'font')).toEqual(['bold', 'italic', 'strike', 'code', 'clear-format'])
    expect(itemIds(r, 'home', 'paragraph')).toEqual(['bullet-list', 'numbered-list', 'task-list', 'quote', 'outdent', 'indent'])
    expect(itemIds(r, 'home', 'styles')).toEqual(['styles'])
    expect(itemIds(r, 'home', 'editing')).toEqual(['find', 'replace', 'select-all'])
    expect(itemIds(r, 'home', 'history')).toEqual(['undo', 'redo'])
    expect(itemIds(r, 'insert', 'insert-basic')).toEqual(['link', 'hr', 'code-block'])
    expect(itemIds(r, 'insert', 'insert-objects')).toEqual(['table-insert', 'math-block', 'graph-block', 'image-insert'])
    expect(byId(r, 'paste').size).toBe('large')
  })

  it('markdown has none of the rich controls', () => {
    const ids = ribbonControls(build('markdown')).map((i) => i.id)
    for (const id of ['font-family', 'font-size', 'font-grow', 'underline', 'text-color', 'align-left', 'line-spacing', 'margins']) {
      expect(ids).not.toContain(id)
    }
  })

  it('rich adds the Font and Paragraph controls and a Layout tab', () => {
    const r = build('rich')
    expect(r.tabs.map((t) => t.id)).toEqual(['home', 'insert', 'layout'])
    expect(itemIds(r, 'home', 'font')).toEqual([
      'font-family', 'font-size', 'font-grow', 'font-shrink', 'bold', 'italic', 'underline', 'strike',
      'subscript', 'superscript', 'code', 'text-color', 'highlight-color', 'clear-format',
    ])
    expect(itemIds(r, 'home', 'paragraph')).toEqual([
      'bullet-list', 'numbered-list', 'task-list', 'quote', 'outdent', 'indent',
      'align-left', 'align-center', 'align-right', 'align-justify', 'line-spacing',
    ])
    const size = byId(r, 'font-size')
    expect(size).toMatchObject({ kind: 'number', min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, unit: 'pt', step: 1 })
    expect(byId(r, 'font-family').kind).toBe('select')
    expect(byId(r, 'text-color').kind).toBe('color')
    expect(byId(r, 'highlight-color').kind).toBe('color')
  })

  it('Layout items are disabled placeholders; Table and Image are disabled with a tooltip', () => {
    const r = build('rich')
    for (const id of ['margins', 'orientation', 'page-size']) {
      expect(byId(r, id)).toMatchObject({ enabled: false, placeholder: true })
    }
    expect(byId(r, 'table-insert')).toMatchObject({ enabled: false, tooltip: 'Arrives with the table editor' })
    expect(byId(r, 'image-insert').enabled).toBe(false)
    // disabled even when everything else is enabled, and running one does nothing
    const h = mkHandlers()
    const md = build('markdown', {}, h)
    ;(byId(md, 'table-insert') as { run(): void }).run()
    expect(h.command).not.toHaveBeenCalled()
  })

  it('every item has a known icon, a label, and unique ids', () => {
    for (const mode of ['markdown', 'rich'] as const) {
      const r = build(mode)
      const all = r.tabs.flatMap((t) => t.groups.flatMap((g) => g.items))
      const ids = all.map((i) => i.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const i of all) {
        if (i.kind === 'separator') continue
        expect(ICON_NAMES as readonly string[]).toContain(i.icon)
        expect(i.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('every shortcut is unique within a ribbon', () => {
    for (const mode of ['markdown', 'rich'] as const) {
      const keys = ribbonControls(build(mode)).flatMap((i) => (i.shortcut ? [i.shortcut] : []))
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.length).toBeGreaterThan(8)
    }
  })
})

describe('buildRibbon state', () => {
  it('readOnly disables everything that edits and keeps find / copy / select all', () => {
    for (const mode of ['markdown', 'rich'] as const) {
      const r = build(mode, { readOnly: true })
      const enabled = ribbonControls(r).filter((i) => i.enabled).map((i) => i.id).sort()
      expect(enabled).toEqual(['copy', 'find', 'select-all'])
    }
  })

  it('clipboard availability, selection, and history depth gate their buttons', () => {
    const r = build('markdown', { clipboard: false, selectionEmpty: true, undoDepth: 0, redoDepth: 0 })
    for (const id of ['paste', 'cut', 'copy', 'undo', 'redo']) expect(byId(r, id).enabled).toBe(false)
    expect(byId(r, 'replace').enabled).toBe(true)
    const r2 = build('markdown', { undoDepth: 3, redoDepth: 0 })
    expect(byId(r2, 'undo').enabled).toBe(true)
    expect(byId(r2, 'redo').enabled).toBe(false)
    expect(byId(r2, 'paste').enabled).toBe(true)
    expect(byId(r2, 'cut').enabled).toBe(true)
  })

  it('toggle active flags come from the marks', () => {
    const r = build('markdown', { marks: { ...NO_MARKS, bold: true, task: true, quote: true } })
    expect(byId(r, 'bold')).toMatchObject({ kind: 'toggle', active: true })
    expect(byId(r, 'italic').active).toBe(false)
    expect(byId(r, 'task-list').active).toBe(true)
    expect(byId(r, 'bullet-list').active).toBe(false)
    expect(byId(r, 'quote').active).toBe(true)
  })

  it('the Styles gallery highlights the current block style', () => {
    const gal = (style: RibbonState['blockStyle']) => byId(build('markdown', { blockStyle: style }), 'styles') as RibbonGallery
    expect(gal('h2').value).toBe('h2')
    expect(gal('code').value).toBe('code')
    expect(gal('quote').value).toBe('quote')
    expect(gal('normal').value).toBe('normal')
    expect(gal('list').value).toBe('normal')
    expect(gal('normal').options.map((o) => o.value)).toEqual(['normal', 'h1', 'h2', 'h3', 'h4', 'quote', 'code'])
    expect(gal('normal').options.map((o) => o.label)).toEqual(['Normal', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Quote', 'Code block'])
    expect(gal('normal').options.find((o) => o.value === 'h1')!.preview).toMatchObject({ fontScale: 2, weight: 700 })
    expect(gal('normal').options.find((o) => o.value === 'code')!.preview).toMatchObject({ mono: true })
  })

  it('rich state drives the font, size, alignment and spacing controls', () => {
    const r = build('rich', { rich: { fontFamily: 'Georgia', fontSize: 14, underline: true, align: 'justify', lineSpacing: '1.5', color: '#c00000' } })
    expect(byId(r, 'font-family')).toMatchObject({ value: 'Georgia' })
    expect(byId(r, 'font-size')).toMatchObject({ value: 14 })
    expect(byId(r, 'underline').active).toBe(true)
    expect(byId(r, 'align-justify').active).toBe(true)
    expect(byId(r, 'align-left').active).toBe(false)
    expect((byId(r, 'line-spacing') as RibbonSelect).value).toBe('1.5')
    expect(byId(r, 'text-color')).toMatchObject({ value: '#c00000' })
    expect(byId(build('rich', { rich: { fontSize: FONT_SIZE_MAX } }), 'font-grow').enabled).toBe(false)
    expect(byId(build('rich', { rich: { fontSize: FONT_SIZE_MIN } }), 'font-shrink').enabled).toBe(false)
    expect(byId(build('rich', { rich: { fontSize: 12 } }), 'font-grow').enabled).toBe(true)
  })
})

describe('handlers', () => {
  it('buttons and toggles call command(id); gallery calls blockStyle; selects call setValue', () => {
    const h = mkHandlers()
    const r = build('rich', {}, h)
    ;(byId(r, 'bold') as { run(): void }).run()
    ;(byId(r, 'paste') as { run(): void }).run()
    expect(h.command.mock.calls).toEqual([['bold'], ['paste']])
    ;(byId(r, 'styles') as RibbonGallery).onChange('h3')
    expect(h.blockStyle).toHaveBeenCalledWith('h3')
    ;(byId(r, 'font-family') as RibbonSelect).onChange('Arial')
    expect(h.setValue).toHaveBeenCalledWith('font-family', 'Arial')
    ;(byId(r, 'font-size') as unknown as { onChange(v: number): void }).onChange(18)
    expect(h.setValue).toHaveBeenCalledWith('font-size', 18)
  })
})

describe('flattenRibbon', () => {
  it('drops separators and placeholders, leads with priority items, keeps ribbon order after', () => {
    const r = build('rich')
    const flat = flattenRibbon(r)
    const ids = flat.map((i) => i.id)
    for (const id of ['margins', 'orientation', 'page-size', 'table-insert', 'image-insert']) expect(ids).not.toContain(id)
    expect(ids.slice(0, 9)).toEqual(['undo', 'redo', 'bold', 'italic', 'styles', 'link', 'bullet-list', 'numbered-list', 'find'])
    // the rest keep their ribbon order
    const rest = ids.slice(9)
    const ribbonOrder = ribbonControls(r).map((i) => i.id).filter((id) => rest.includes(id))
    expect(rest).toEqual(ribbonOrder)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('keeps disabled non-placeholders (readOnly) so the row does not jump', () => {
    const ids = flattenRibbon(build('markdown', { readOnly: true })).map((i) => i.id)
    expect(ids).toContain('bold')
    expect(ids).not.toContain('table-insert')
  })
})

describe('ribbonToToolbarCommands', () => {
  it('maps buttons and toggles one to one with flags and shortcuts', () => {
    const cmds = ribbonToToolbarCommands(build('markdown', { marks: { ...NO_MARKS, italic: true } }))
    const bold = cmds.find((c) => c.id === 'bold')!
    expect(bold).toMatchObject({ label: 'Bold', icon: 'doc-bold', group: 'font', enabled: true, active: false, shortcut: 'Mod-b' })
    expect(cmds.find((c) => c.id === 'italic')!.active).toBe(true)
    expect(cmds.find((c) => c.id === 'copy')!.shortcut).toBe('Mod-c')
  })
  it('expands the gallery to one command per option, grouped under its label', () => {
    const h = mkHandlers()
    const cmds = ribbonToToolbarCommands(build('markdown', { blockStyle: 'h2' }, h))
    const styles = cmds.filter((c) => c.id.startsWith('styles:'))
    expect(styles.map((c) => c.id)).toEqual(['styles:normal', 'styles:h1', 'styles:h2', 'styles:h3', 'styles:h4', 'styles:quote', 'styles:code'])
    expect(styles.every((c) => c.group === 'Styles')).toBe(true)
    expect(styles.filter((c) => c.active).map((c) => c.id)).toEqual(['styles:h2'])
    styles[1].run()
    expect(h.blockStyle).toHaveBeenCalledWith('h1')
  })
  it('expands selects, skips number / color / placeholders, ids stay unique', () => {
    const cmds = ribbonToToolbarCommands(build('rich'))
    const ids = cmds.map((c) => c.id)
    expect(ids).toContain('font-family:Arial')
    expect(ids).toContain('line-spacing:1.5')
    for (const skip of ['font-size', 'text-color', 'highlight-color', 'margins:normal', 'table-insert']) expect(ids).not.toContain(skip)
    expect(new Set(ids).size).toBe(ids.length)
    expect(cmds.find((c) => c.id === 'font-family:Arial')!.group).toBe('Font')
  })
  it('readOnly flags carry through', () => {
    const cmds = ribbonToToolbarCommands(build('markdown', { readOnly: true }))
    expect(cmds.find((c) => c.id === 'bold')!.enabled).toBe(false)
    expect(cmds.find((c) => c.id === 'find')!.enabled).toBe(true)
  })
})
