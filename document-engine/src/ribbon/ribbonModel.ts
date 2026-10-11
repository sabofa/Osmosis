// The ribbon as pure data: tabs hold groups hold items. buildRibbon() turns
// the editor's facts (active marks, current block style, selection, history
// depth, read-only, clipboard) plus a handler set into the tree; a UI renders
// it and never needs to know which editor mode is behind it. Nothing here
// touches CodeMirror or the DOM (type-only imports), so the later rich-text
// mode builds against the same contract.
import type { ToolbarCommand } from 'engine-host'
import type { IconName } from '../iconSheet'
import type { ActiveMarks, EditorCommandId, BlockStyle, SettableBlockStyle } from '../editor/editorCommands'

export type RibbonMode = 'markdown' | 'rich'

/** Commands only the rich mode will implement (the model carries them already). */
export type RichCommandId =
  | 'underline' | 'subscript' | 'superscript' | 'font-grow' | 'font-shrink'
  | 'align-left' | 'align-center' | 'align-right' | 'align-justify'
export type RibbonCommandId = EditorCommandId | RichCommandId
export type RibbonValueId =
  | 'font-family' | 'font-size' | 'text-color' | 'highlight-color' | 'line-spacing'
  | 'margins' | 'orientation' | 'page-size'
export type RibbonValue = string | number | null

/** Plain-data look hints for one option (a UI maps them to CSS; no CSS here). */
export interface RibbonPreview {
  fontScale?: number
  weight?: number
  italic?: boolean
  mono?: boolean
  family?: string
  color?: string
}
export interface RibbonOption {
  value: string
  label: string
  preview?: RibbonPreview
}

interface ItemBase {
  id: string
  label: string
  icon: IconName
  shortcut?: string
  tooltip?: string
  enabled: boolean
  active: boolean
  size: 'large' | 'small'
  /** Lower comes first when the ribbon collapses to one row. */
  priority: number
  /** Disabled stand-in for something that does not exist yet (skipped by the collapse). */
  placeholder?: boolean
}
export interface RibbonButton extends ItemBase { kind: 'button'; run: () => void }
export interface RibbonToggle extends ItemBase { kind: 'toggle'; run: () => void }
export interface RibbonSelect extends ItemBase { kind: 'select'; options: RibbonOption[]; value: string; onChange: (value: string) => void }
export interface RibbonGallery extends ItemBase { kind: 'gallery'; options: RibbonOption[]; value: string; onChange: (value: string) => void }
export interface RibbonNumber extends ItemBase { kind: 'number'; min: number; max: number; step: number; value: number; unit: string; onChange: (value: number) => void }
export interface RibbonColor extends ItemBase { kind: 'color'; value: string | null; swatches: string[]; onChange: (value: string | null) => void }
export interface RibbonSeparator { kind: 'separator'; id: string }

export type RibbonControl = RibbonButton | RibbonToggle | RibbonSelect | RibbonGallery | RibbonNumber | RibbonColor
export type RibbonItem = RibbonControl | RibbonSeparator

export interface RibbonGroup { id: string; label: string; items: RibbonItem[] }
export interface RibbonTab { id: string; label: string; groups: RibbonGroup[] }
export interface Ribbon { mode: RibbonMode; tabs: RibbonTab[] }

// ------------------------------------------------------------------ inputs

export interface RichState {
  fontFamily: string
  fontSize: number
  color: string | null
  highlight: string | null
  underline: boolean
  subscript: boolean
  superscript: boolean
  align: 'left' | 'center' | 'right' | 'justify'
  lineSpacing: string
}
export const DEFAULT_RICH_STATE: RichState = {
  fontFamily: 'Calibri', fontSize: 11, color: null, highlight: null,
  underline: false, subscript: false, superscript: false, align: 'left', lineSpacing: '1.15',
}

export interface RibbonState {
  marks: ActiveMarks
  blockStyle: BlockStyle
  selectionEmpty: boolean
  undoDepth: number
  redoDepth: number
  readOnly: boolean
  /** Whether the clipboard can be read (the Paste button needs it). */
  clipboard: boolean
  rich?: Partial<RichState>
}

export interface RibbonHandlers {
  command(id: RibbonCommandId): void
  blockStyle(style: SettableBlockStyle): void
  setValue(id: RibbonValueId, value: RibbonValue): void
}

// ----------------------------------------------------------------- catalogue

export const STYLE_OPTIONS: RibbonOption[] = [
  { value: 'normal', label: 'Normal', preview: { fontScale: 1 } },
  { value: 'h1', label: 'Heading 1', preview: { fontScale: 2, weight: 700 } },
  { value: 'h2', label: 'Heading 2', preview: { fontScale: 1.5, weight: 700 } },
  { value: 'h3', label: 'Heading 3', preview: { fontScale: 1.25, weight: 600 } },
  { value: 'h4', label: 'Heading 4', preview: { fontScale: 1.1, weight: 600 } },
  { value: 'quote', label: 'Quote', preview: { fontScale: 1, italic: true } },
  { value: 'code', label: 'Code block', preview: { fontScale: 0.92, mono: true } },
]

const FONT_OPTIONS: RibbonOption[] = [
  { value: 'Calibri', label: 'Calibri', preview: { family: 'Calibri' } },
  { value: 'Arial', label: 'Arial', preview: { family: 'Arial' } },
  { value: 'Georgia', label: 'Georgia', preview: { family: 'Georgia' } },
  { value: 'Times New Roman', label: 'Times New Roman', preview: { family: 'Times New Roman' } },
  { value: 'Courier New', label: 'Courier New', preview: { family: 'Courier New', mono: true } },
]
const SPACING_OPTIONS: RibbonOption[] = ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'].map((v) => ({ value: v, label: v }))
const MARGIN_OPTIONS: RibbonOption[] = [
  { value: 'normal', label: 'Normal' }, { value: 'narrow', label: 'Narrow' },
  { value: 'moderate', label: 'Moderate' }, { value: 'wide', label: 'Wide' },
]
const ORIENTATION_OPTIONS: RibbonOption[] = [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]
const PAGE_OPTIONS: RibbonOption[] = [{ value: 'letter', label: 'Letter' }, { value: 'a4', label: 'A4' }, { value: 'legal', label: 'Legal' }]
const SWATCHES = ['#000000', '#c00000', '#e36c09', '#bf9000', '#2e7d32', '#1565c0', '#6a1b9a', '#7f7f7f']
const HIGHLIGHTS = ['#fff59d', '#ffe0b2', '#c8e6c9', '#b3e5fc', '#e1bee7', '#ffcdd2']

export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 96

/** Collapse order: lower first; everything else is 50 and keeps ribbon order. */
const PRIORITY: Record<string, number> = {
  undo: 0, redo: 1, bold: 2, italic: 3, styles: 4, link: 5, 'bullet-list': 6, 'numbered-list': 7, find: 8,
}

// -------------------------------------------------------------------- build

export interface BuildRibbonInput {
  mode: RibbonMode
  state: RibbonState
  handlers: RibbonHandlers
}

export function buildRibbon({ mode, state, handlers: h }: BuildRibbonInput): Ribbon {
  const rich = mode === 'rich'
  const edit = !state.readOnly
  const hasSel = !state.selectionEmpty
  const rs: RichState = { ...DEFAULT_RICH_STATE, ...(state.rich ?? {}) }

  type Extra = Partial<Pick<ItemBase, 'shortcut' | 'tooltip' | 'size' | 'placeholder'>>
  const base = (id: string, label: string, icon: IconName, enabled: boolean, active: boolean, x: Extra = {}): ItemBase => ({
    id, label, icon, enabled, active, size: x.size ?? 'small', priority: PRIORITY[id] ?? 50,
    ...(x.shortcut ? { shortcut: x.shortcut } : {}),
    ...(x.tooltip ? { tooltip: x.tooltip } : {}),
    ...(x.placeholder ? { placeholder: true } : {}),
  })
  const button = (id: string, label: string, icon: IconName, enabled: boolean, x: Extra = {}): RibbonButton => ({
    kind: 'button', ...base(id, label, icon, enabled, false, x), run: () => { if (!x.placeholder) h.command(id as RibbonCommandId) },
  })
  const toggle = (id: RibbonCommandId, label: string, icon: IconName, enabled: boolean, active: boolean, x: Extra = {}): RibbonToggle => ({
    kind: 'toggle', ...base(id, label, icon, enabled, active, x), run: () => h.command(id),
  })
  const select = (id: RibbonValueId, label: string, icon: IconName, enabled: boolean, options: RibbonOption[], value: string, x: Extra = {}): RibbonSelect => ({
    kind: 'select', ...base(id, label, icon, enabled, false, x), options, value, onChange: (v) => h.setValue(id, v),
  })
  const sep = (n: string): RibbonSeparator => ({ kind: 'separator', id: `sep-${n}` })
  const group = (id: string, label: string, items: RibbonItem[]): RibbonGroup => ({ id, label, items })
  const m = state.marks

  // ---- Home
  const clipboard = group('clipboard', 'Clipboard', [
    button('paste', 'Paste', 'doc-paste', edit && state.clipboard, { size: 'large', shortcut: 'Mod-v' }),
    button('cut', 'Cut', 'doc-cut', edit && hasSel, { shortcut: 'Mod-x' }),
    button('copy', 'Copy', 'doc-copy', hasSel, { shortcut: 'Mod-c' }),
  ])

  const fontItems: RibbonItem[] = []
  if (rich) {
    fontItems.push(
      select('font-family', 'Font', 'doc-font', edit, FONT_OPTIONS, rs.fontFamily),
      {
        kind: 'number', ...base('font-size', 'Font size', 'doc-font', edit, false),
        min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1, value: rs.fontSize, unit: 'pt',
        onChange: (v) => h.setValue('font-size', v),
      } as RibbonNumber,
      button('font-grow', 'Grow font', 'doc-font-grow', edit && rs.fontSize < FONT_SIZE_MAX, { shortcut: 'Mod-Shift-.' }),
      button('font-shrink', 'Shrink font', 'doc-font-shrink', edit && rs.fontSize > FONT_SIZE_MIN, { shortcut: 'Mod-Shift-,' }),
      sep('font-size'),
    )
  }
  fontItems.push(
    toggle('bold', 'Bold', 'doc-bold', edit, m.bold, { shortcut: 'Mod-b' }),
    toggle('italic', 'Italic', 'doc-italic', edit, m.italic, { shortcut: 'Mod-i' }),
  )
  if (rich) fontItems.push(toggle('underline', 'Underline', 'doc-underline', edit, rs.underline, { shortcut: 'Mod-u' }))
  fontItems.push(toggle('strike', 'Strikethrough', 'doc-strike', edit, m.strike))
  if (rich) {
    fontItems.push(
      toggle('subscript', 'Subscript', 'doc-subscript', edit, rs.subscript, { shortcut: 'Mod-=' }),
      toggle('superscript', 'Superscript', 'doc-superscript', edit, rs.superscript, { shortcut: 'Mod-Shift-=' }),
    )
  }
  fontItems.push(toggle('code', 'Code', 'doc-code', edit, m.code, rich ? {} : { shortcut: 'Mod-e' }))
  if (rich) {
    fontItems.push(
      sep('font-color'),
      {
        kind: 'color', ...base('text-color', 'Text colour', 'doc-text-color', edit, false),
        value: rs.color, swatches: SWATCHES, onChange: (v) => h.setValue('text-color', v),
      } as RibbonColor,
      {
        kind: 'color', ...base('highlight-color', 'Highlight', 'doc-highlight', edit, false),
        value: rs.highlight, swatches: HIGHLIGHTS, onChange: (v) => h.setValue('highlight-color', v),
      } as RibbonColor,
    )
  }
  fontItems.push(sep('font-clear'), button('clear-format', 'Clear formatting', 'doc-clear-format', edit))
  const font = group('font', 'Font', fontItems)

  const paragraphItems: RibbonItem[] = [
    toggle('bullet-list', 'Bullets', 'doc-list-bullet', edit, m.bullet),
    toggle('numbered-list', 'Numbering', 'doc-list-number', edit, m.numbered),
    toggle('task-list', 'Tasks', 'doc-list-task', edit, m.task),
    toggle('quote', 'Quote', 'doc-quote', edit, m.quote),
    sep('para-indent'),
    button('outdent', 'Outdent', 'doc-outdent', edit),
    button('indent', 'Indent', 'doc-indent', edit),
  ]
  if (rich) {
    paragraphItems.push(
      sep('para-align'),
      toggle('align-left', 'Align left', 'doc-align-left', edit, rs.align === 'left', { shortcut: 'Mod-l' }),
      toggle('align-center', 'Center', 'doc-align-center', edit, rs.align === 'center', { shortcut: 'Mod-e' }),
      toggle('align-right', 'Align right', 'doc-align-right', edit, rs.align === 'right', { shortcut: 'Mod-r' }),
      toggle('align-justify', 'Justify', 'doc-align-justify', edit, rs.align === 'justify', { shortcut: 'Mod-j' }),
      select('line-spacing', 'Line spacing', 'doc-line-spacing', edit, SPACING_OPTIONS, rs.lineSpacing),
    )
  }
  const paragraph = group('paragraph', 'Paragraph', paragraphItems)

  const styles = group('styles', 'Styles', [{
    kind: 'gallery', ...base('styles', 'Styles', 'doc-heading', edit, false, { size: 'large' }),
    options: STYLE_OPTIONS,
    // a list line has no entry in the gallery; it reads as Normal
    value: state.blockStyle === 'list' ? 'normal' : state.blockStyle,
    onChange: (v) => h.blockStyle(v as SettableBlockStyle),
  } as RibbonGallery])

  const editing = group('editing', 'Editing', [
    button('find', 'Find', 'doc-search', true, { shortcut: 'Mod-f' }),
    button('replace', 'Replace', 'doc-replace', edit, { shortcut: 'Mod-h' }),
    button('select-all', 'Select all', 'doc-select-all', true, { shortcut: 'Mod-a' }),
  ])

  const history = group('history', 'History', [
    button('undo', 'Undo', 'doc-undo', edit && state.undoDepth > 0, { shortcut: 'Mod-z' }),
    button('redo', 'Redo', 'doc-redo', edit && state.redoDepth > 0, { shortcut: 'Mod-Shift-z' }),
  ])

  const home: RibbonTab = { id: 'home', label: 'Home', groups: [clipboard, font, paragraph, styles, editing, history] }

  // ---- Insert
  const insert: RibbonTab = {
    id: 'insert', label: 'Insert',
    groups: [
      group('insert-basic', 'Basic', [
        button('link', 'Link', 'doc-link', edit, { shortcut: 'Mod-k' }),
        button('hr', 'Horizontal rule', 'doc-hr', edit),
        button('code-block', 'Code block', 'doc-code-block', edit),
      ]),
      group('insert-objects', 'Objects', [
        button('table-insert', 'Table', 'doc-table', false, { size: 'large', placeholder: true, tooltip: 'Arrives with the table editor' }),
        button('math-block', 'Math block', 'doc-math', edit, { size: 'large' }),
        button('graph-block', 'Graph', 'doc-graph', edit, { size: 'large' }),
        button('image-insert', 'Image', 'doc-image', false, { size: 'large', placeholder: true, tooltip: 'Images are not supported yet' }),
      ]),
    ],
  }

  const tabs: RibbonTab[] = [home, insert]

  // ---- Layout (rich only; nothing behind it yet)
  if (rich) {
    const soon = { placeholder: true, tooltip: 'Arrives with the rich text mode' }
    tabs.push({
      id: 'layout', label: 'Layout',
      groups: [group('page-setup', 'Page Setup', [
        select('margins', 'Margins', 'doc-margins', false, MARGIN_OPTIONS, 'normal', soon),
        select('orientation', 'Orientation', 'doc-orientation', false, ORIENTATION_OPTIONS, 'portrait', soon),
        select('page-size', 'Size', 'doc-page-size', false, PAGE_OPTIONS, 'letter', soon),
      ])],
    })
  }

  return { mode, tabs }
}

// ------------------------------------------------------------------ derived

/** Every non-separator item, in tab / group / item order. */
export function ribbonControls(ribbon: Ribbon): RibbonControl[] {
  const out: RibbonControl[] = []
  for (const t of ribbon.tabs) for (const g of t.groups) for (const i of g.items) if (i.kind !== 'separator') out.push(i)
  return out
}

/**
 * The one-row collapse for narrow hosts: separators and disabled placeholders
 * dropped, the rest ordered by priority (ties keep ribbon order).
 */
export function flattenRibbon(ribbon: Ribbon): RibbonControl[] {
  return ribbonControls(ribbon)
    .filter((i) => !i.placeholder)
    .map((item, order) => ({ item, order }))
    .sort((a, b) => a.item.priority - b.item.priority || a.order - b.order)
    .map((e) => e.item)
}

/**
 * For hosts that only know ToolbarCommand: buttons and toggles map one to one;
 * a select or gallery becomes one command per option (group = the group label, like the buttons, active
 * on the current value). Number and colour controls have no command form and
 * are left out, as are placeholders.
 */
export function ribbonToToolbarCommands(ribbon: Ribbon): ToolbarCommand[] {
  const out: ToolbarCommand[] = []
  for (const t of ribbon.tabs) {
    for (const g of t.groups) {
      for (const i of g.items) {
        if (i.kind === 'separator' || i.placeholder) continue
        if (i.kind === 'button' || i.kind === 'toggle') {
          const c: ToolbarCommand = { id: i.id, label: i.label, icon: i.icon, group: g.label, enabled: i.enabled, active: i.active, run: i.run }
          if (i.shortcut) c.shortcut = i.shortcut
          out.push(c)
        } else if (i.kind === 'select' || i.kind === 'gallery') {
          for (const o of i.options) {
            out.push({
              id: `${i.id}:${o.value}`, label: o.label, icon: i.icon, group: g.label,
              enabled: i.enabled, active: o.value === i.value, run: () => i.onChange(o.value),
            })
          }
        }
      }
    }
  }
  return out
}
