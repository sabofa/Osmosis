import { mix } from '../colour.js'
import { def, hex, type TokenDef, type TokenType } from './types.js'

type Row = [name: string, from: string, meaning: string]

function alias(type: TokenType, rows: Row[]): TokenDef[] {
  return rows.map(([name, from, meaning]) =>
    def(name, 'component', type, meaning, (c) => c.get(from), {
      tier: 'component',
      modeDependent: type !== 'length',
    }))
}

const colours: Row[] = [
  ['sidebar-bg', 'color-surface', 'Background of the sidebar.'],
  ['sidebar-border', 'color-border', 'Border line between the sidebar and the content.'],
  ['sidebar-row-active-bg', 'color-accent-wash', 'Background of the selected sidebar row.'],
  ['sidebar-row-active-text', 'color-accent-text', 'Text colour of the selected sidebar row.'],
  ['tab-bg', 'color-canvas', 'Background of inactive tabs and the tab strip.'],
  ['tab-text', 'color-text-muted', 'Text colour of inactive tabs.'],
  ['tab-active-bg', 'color-surface', 'Background of the active tab.'],
  ['tab-active-text', 'color-text', 'Text colour of the active tab.'],
  ['tab-border', 'color-border', 'Border line of tabs and the tab strip.'],
  ['panel-bg', 'color-surface', 'Background of panels and docked regions.'],
  ['panel-border', 'color-border', 'Border line around panels.'],
  ['card-bg', 'color-surface-raised', 'Background of cards.'],
  ['card-border', 'color-border', 'Border line around cards.'],
  ['input-bg', 'color-surface', 'Background of text inputs and fields.'],
  ['input-border', 'color-border-strong', 'Border of text inputs and fields at rest.'],
  ['input-border-focus', 'color-focus', 'Border of a focused input.'],
  ['input-text', 'color-text', 'Text colour inside inputs.'],
  ['input-placeholder', 'color-text-faint', 'Placeholder text colour inside inputs.'],
  ['button-primary-bg', 'color-accent', 'Background of primary buttons.'],
  ['button-primary-hover-bg', 'color-accent-hover', 'Background of primary buttons on hover.'],
  ['button-primary-text', 'color-text-on-accent', 'Label colour of primary buttons.'],
  ['button-secondary-bg', 'color-surface', 'Background of secondary buttons.'],
  ['button-secondary-hover-bg', 'color-surface-sunken', 'Background of secondary buttons on hover.'],
  ['button-secondary-text', 'color-text', 'Label colour of secondary buttons.'],
  ['button-secondary-border', 'color-border-strong', 'Border of secondary buttons.'],
  ['chip-bg', 'color-accent-wash', 'Background of chips and tags.'],
  ['chip-text', 'color-accent-text', 'Text colour of chips and tags.'],
  ['menu-bg', 'color-surface-overlay', 'Background of dropdown and context menus.'],
  ['menu-border', 'color-border', 'Border of dropdown and context menus.'],
  ['menu-hover', 'color-surface-sunken', 'Background of a hovered menu item.'],
  ['modal-bg', 'color-surface-overlay', 'Background of modal dialogs.'],
  ['modal-scrim', 'color-scrim', 'Dimming layer behind modal dialogs.'],
  ['code-bg', 'color-surface-sunken', 'Background of code blocks and inline code.'],
  ['code-text', 'color-text', 'Text colour of code.'],
  ['code-border', 'color-border', 'Border around code blocks.'],
  ['table-header-bg', 'color-surface-sunken', 'Background of table header rows.'],
  ['table-stripe-bg', 'doc-table-stripe', 'Background of alternate table rows.'],
  ['table-border', 'color-border', 'Border lines of tables.'],
  ['toast-bg', 'color-text', 'Background of toast notifications (inverted against the page).'],
  ['toast-text', 'color-canvas', 'Text colour of toast notifications.'],
  ['badge-good-bg', 'color-good-wash', 'Background of success badges.'],
  ['badge-bad-bg', 'color-bad-wash', 'Background of error badges.'],
]

const shadows: Row[] = [
  ['panel-shadow', 'shadow-1', 'Shadow under panels.'],
  ['card-shadow', 'shadow-1', 'Shadow under cards.'],
  ['menu-shadow', 'shadow-3', 'Shadow under dropdown and context menus.'],
  ['modal-shadow', 'shadow-3', 'Shadow under modal dialogs.'],
]

const radii: Row[] = [
  ['panel-radius', 'radius-lg', 'Corner radius of panels.'],
  ['card-radius', 'radius-lg', 'Corner radius of cards.'],
  ['input-radius', 'radius-md', 'Corner radius of inputs.'],
  ['button-radius', 'radius-md', 'Corner radius of buttons.'],
  ['chip-radius', 'radius-pill', 'Corner radius of chips and tags.'],
  ['menu-radius', 'radius-md', 'Corner radius of menus.'],
  ['modal-radius', 'radius-xl', 'Corner radius of modal dialogs.'],
]

export const COMPONENT_TOKENS: TokenDef[] = [
  ...alias('color', colours),
  def('sidebar-row-hover', 'component', 'color', 'Background of a hovered sidebar row (surface nudged toward the accent).',
    (c) => hex(mix(c.col('color-surface'), c.col('color-accent'), 0.06)), { tier: 'component', modeDependent: true }),
  ...alias('shadow', shadows),
  ...alias('length', radii),
]
