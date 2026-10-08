import { withA } from '../colour.js'
import { DEFAULT_FONTS, FONT_STACKS, type FontRole } from '../manifest.js'
import { def, hex, type DeriveCtx, type Group, type TokenDef, type TokenType } from './types.js'

const round05 = (x: number): number => Math.round(x * 2) / 2
const px = (x: number): string => `${round05(x)}px`
const fmt = (x: number): string => String(Number(x.toFixed(3)))

type Row = [string, string, (c: DeriveCtx) => string]

function group(g: Group, type: TokenType, rows: Row[]): TokenDef[] {
  return rows.map(([name, meaning, derive]) => def(name, g, type, meaning, derive, { modeDependent: false }))
}

// ── type ───────────────────────────────────────────────────────────────────
const fontRows: Row[] = (
  [
    ['display', 'Font stack for large headings and titles.'],
    ['body', 'Font stack for running text and most UI labels.'],
    ['mono', 'Font stack for code, numbers in tables and technical readouts.'],
    ['math', 'Font stack for typeset mathematics and equations.'],
  ] as Array<[FontRole, string]>
).map(([role, meaning]): Row => [`font-${role}`, meaning, (c) => {
  const ref = c.fonts[role]
  if ('stack' in ref) return FONT_STACKS[ref.stack]
  const fb = DEFAULT_FONTS[role]
  return FONT_STACKS['stack' in fb ? fb.stack : 'inter']
}])

const sizeRow = (name: string, meaning: string, f: (base: number, r: number) => number): Row =>
  [name, meaning, (c) => px(f(c.dials.baseSize, c.dials.typeScale))]

export const TYPE_TOKENS: TokenDef[] = [
  ...group('type', 'font', fontRows),
  ...group('type', 'length', [
    sizeRow('text-2xs', 'Smallest text: dense badges and axis ticks.', (b) => b * 0.72),
    sizeRow('text-xs', 'Fine print, captions and metadata.', (b) => b * 0.82),
    sizeRow('text-sm', 'Compact UI text: table cells, secondary labels.', (b) => b * 0.92),
    sizeRow('text-md', 'Base body and UI text size.', (b) => b),
    sizeRow('text-lg', 'Lead paragraphs and small headings (one scale step up).', (b, r) => b * r),
    sizeRow('text-xl', 'Section headings (two scale steps up).', (b, r) => b * r ** 2),
    sizeRow('text-2xl', 'Page headings (three scale steps up).', (b, r) => b * r ** 3),
    sizeRow('text-3xl', 'Display titles and hero text (four scale steps up).', (b, r) => b * r ** 4),
  ]),
  ...group('type', 'number', [
    ['leading-tight', 'Line height for headings and single-line labels.', () => '1.25'],
    ['leading-normal', 'Line height for body text.', () => '1.5'],
    ['leading-loose', 'Line height for long-form reading and relaxed layouts.', () => '1.75'],
    ['weight-regular', 'Font weight of normal text.', () => '400'],
    ['weight-medium', 'Font weight of emphasised labels and buttons.', () => '500'],
    ['weight-bold', 'Font weight of headings and strong emphasis.', () => '700'],
  ]),
]

// ── shape ──────────────────────────────────────────────────────────────────
const rad = (c: DeriveCtx): number => round05(16 * c.dials.roundness * 1.5)
export const SHAPE_TOKENS: TokenDef[] = group('shape', 'length', [
  ['radius-xs', 'Corner radius of the smallest elements: checkboxes, tags, inline code.', (c) => px(rad(c) * 0.3)],
  ['radius-sm', 'Corner radius of small controls: inputs, small buttons.', (c) => px(rad(c) * 0.6)],
  ['radius-md', 'Default corner radius of buttons, cards and panels.', (c) => px(rad(c))],
  ['radius-lg', 'Corner radius of large containers: dialogs, big cards.', (c) => px(rad(c) * 1.4)],
  ['radius-xl', 'Corner radius of the largest surfaces: sheets and hero panels.', (c) => px(rad(c) * 2)],
  ['radius-pill', 'Fully rounded ends for pills and toggles; square when roundness is 0.', (c) => (c.dials.roundness === 0 ? '0px' : '999px')],
  ['border-width', 'Default border thickness; 0 when the theme wants borderless surfaces.', (c) => (c.dials.borders < 0.1 ? '0px' : '1px')],
  ['border-width-strong', 'Thickness of emphasised borders and focus outlines.', () => '2px'],
])

// ── space ──────────────────────────────────────────────────────────────────
const SPACE_STEPS = [1, 2, 3, 4, 6, 8, 12, 16]
export const SPACE_TOKENS: TokenDef[] = SPACE_STEPS.map((k, i) =>
  def(`space-${i + 1}`, 'space', 'length',
    `Spacing step ${i + 1} of 8 (${k} base units, scaled by density) for padding, gaps and margins.`,
    (c) => px(4 * (0.6 + 0.8 * c.dials.density) * k), { modeDependent: false }))

// ── elevation ──────────────────────────────────────────────────────────────
const SHADOW_USE = ['cards and raised controls', 'popovers and menus', 'dialogs and floating panels']
export const ELEVATION_TOKENS: TokenDef[] = [1, 2, 3].map((k) =>
  def(`shadow-${k}`, 'elevation', 'shadow',
    `Drop shadow at elevation level ${k} of 3, for ${SHADOW_USE[k - 1]}; 'none' when elevation is 0.`,
    (c) => {
      if (c.dials.elevation === 0) return 'none'
      const base = c.col('color-shadow')
      const a = Math.min(1, base.a * (0.4 + c.dials.elevation * 1.2))
      const c1 = hex(withA(base, a)), c2 = hex(withA(base, a / 2))
      return `0 ${k}px ${3 * k + 2}px ${c1}, 0 ${k / 2}px ${(3 * k + 2) / 2}px ${c2}`
    }, { modeDependent: true }))

// ── motion ─────────────────────────────────────────────────────────────────
const dur = (ms: number) => (c: DeriveCtx): string => `${Math.round(ms * c.dials.motion * 2)}ms`
export const MOTION_TOKENS: TokenDef[] = [
  ...group('motion', 'duration', [
    ['motion-fast', 'Duration of micro-interactions: hovers, presses, toggles.', dur(120)],
    ['motion-normal', 'Duration of standard transitions: menus, tabs, panels.', dur(200)],
    ['motion-slow', 'Duration of large transitions: page changes, dialogs.', dur(360)],
  ]),
  ...group('motion', 'easing', [
    ['ease-standard', 'Easing curve for ordinary transitions.', () => 'cubic-bezier(0.2, 0, 0, 1)'],
    ['ease-emphasis', 'Easing curve for attention-drawing entrances that settle slowly.', () => 'cubic-bezier(0.2, 0.8, 0.2, 1)'],
  ]),
]

// ── surface ────────────────────────────────────────────────────────────────
export const SURFACE_TOKENS: TokenDef[] = [
  ...group('surface', 'number', [
    ['surface-alpha', 'Opacity of translucent surfaces (1 is solid); falls as the theme gets glassier.', (c) => fmt(1 - 0.5 * c.dials.translucency)],
  ]),
  ...group('surface', 'length', [
    ['surface-blur', 'Backdrop blur behind translucent surfaces; 0 for solid themes.', (c) => px(24 * c.dials.translucency)],
  ]),
]
