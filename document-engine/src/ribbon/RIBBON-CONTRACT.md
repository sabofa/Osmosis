# Ribbon contract proposal (additive to engine-host)

Status: proposal for the shell chat. Nothing in `engine-host` is changed yet.
The reference implementation of the types and the builder is
`document-engine/src/ribbon/ribbonModel.ts`; this file is what would move
into `engine-host/src/index.ts`.

## Why

`ToolbarCommand` is a flat list of buttons. A Word-style ribbon needs tabs,
groups, and controls that are not buttons (font family select, size spinner,
colour pickers, a Styles gallery). The engine builds the whole tree as plain
data from the editor's state; the host (or the engine's own chrome) renders it.
Both editor modes (markdown now, rich text later) publish the same shape.

## Types (proposed)

```ts
export type RibbonMode = 'markdown' | 'rich'

export interface RibbonPreview {          // look hints as data, no CSS
  fontScale?: number; weight?: number; italic?: boolean; mono?: boolean
  family?: string; color?: string
}
export interface RibbonOption { value: string; label: string; preview?: RibbonPreview }

interface RibbonItemBase {
  id: string                 // unique within the ribbon
  label: string
  icon: string               // icon sheet name (e.g. 'doc-bold')
  shortcut?: string          // CodeMirror spelling, 'Mod' = Ctrl/Cmd
  tooltip?: string           // overrides the default "label (shortcut)"
  enabled: boolean
  active: boolean
  size: 'large' | 'small'
  priority: number           // lower = kept first when collapsing to one row
  placeholder?: boolean      // disabled stand-in for a feature that does not exist yet
}
export type RibbonItem =
  | (RibbonItemBase & { kind: 'button'; run(): void })
  | (RibbonItemBase & { kind: 'toggle'; run(): void })
  | (RibbonItemBase & { kind: 'select';  options: RibbonOption[]; value: string; onChange(v: string): void })
  | (RibbonItemBase & { kind: 'gallery'; options: RibbonOption[]; value: string; onChange(v: string): void })
  | (RibbonItemBase & { kind: 'number';  min: number; max: number; step: number; value: number; unit: string; onChange(v: number): void })
  | (RibbonItemBase & { kind: 'color';   value: string | null; swatches: string[]; onChange(v: string | null): void })
  | { kind: 'separator'; id: string }

export interface RibbonGroup { id: string; label: string; items: RibbonItem[] }
export interface RibbonTab   { id: string; label: string; groups: RibbonGroup[] }
export interface Ribbon      { mode: RibbonMode; tabs: RibbonTab[] }
```

## Host surface

```ts
export interface ToolbarSlot {
  publishCommands(cmds: ToolbarCommand[]): void        // unchanged
  /** Optional. A host that renders ribbons implements it; others ignore it. */
  publishRibbon?(r: Ribbon): void
  clear(): void                                        // clears both
}
```

Rules:

- The engine publishes `publishCommands` as before AND, when the method exists,
  `publishRibbon`. A host without a ribbon renderer keeps working from the flat
  commands (`ribbonToToolbarCommands(ribbon)` derives them: buttons and toggles
  one to one, each select/gallery option one command with `group` = the
  control's label; number and colour controls and placeholders are omitted).
- The ribbon is republished whole whenever its inputs change (selection, marks,
  block style, history depth, read-only). Items are plain data plus callbacks;
  the host must not cache callbacks across publishes.
- Narrow hosts collapse to one row with `flattenRibbon(ribbon)`: separators and
  placeholders dropped, ordered by `priority` then ribbon order.
- `clear()` removes the ribbon.

## New `data-component` names

For theme restyling (to add to the shell's published vocabulary):

| name            | element                                              |
| --------------- | ---------------------------------------------------- |
| `ribbon`        | the whole ribbon strip                               |
| `ribbon-tab`    | a tab header (`aria-selected` marks the open one)    |
| `ribbon-group`  | a group box with its caption                         |
| `ribbon-button` | button / toggle / number / colour trigger            |
| `ribbon-select` | select-style dropdown trigger                        |
| `ribbon-gallery`| the Styles gallery (its option tiles inside)         |

Existing `tool-row`, `pill`, `menu`, `menu-item`, `well` stay for the old toolbar.

## Open points for the shell

- `icon` stays a name resolved against `host.icons`; 29 new `doc-*` names were
  added to the default sheet (clipboard, indent, math, graph, table, alignment,
  font and page-layout glyphs). A non-default sheet falls back per icon.
- Rich-only controls (font, size, colours, alignment, spacing, Layout tab) are
  already in the model but have no engine behind them; Layout items are
  `placeholder: true`.
