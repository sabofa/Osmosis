import { fitLightness, withA, withC, withH, withL, type Oklch } from '../colour.js'
import { def, hex, mixTo, onColour, type DeriveCtx, type TokenDef } from './types.js'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const ok = (l: number, c: number, h: number): Oklch => ({ l, c, h, a: 1 })

function cdef(name: string, meaning: string, derive: (ctx: DeriveCtx) => Oklch): TokenDef {
  return def(name, 'colour', 'color', meaning, (ctx) => hex(derive(ctx)))
}

const light = (ctx: DeriveCtx): boolean => ctx.mode === 'light'

/** Move `from` 10% of the shortest arc toward `to` (degrees). */
function pullHue(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return from + delta * 0.1
}

const tokens: TokenDef[] = []
const add = (name: string, meaning: string, derive: (ctx: DeriveCtx) => Oklch): void => {
  tokens.push(cdef(name, meaning, derive))
}

// ── surfaces ───────────────────────────────────────────────────────────────
add('color-canvas', 'The page background behind everything; the lowest layer of the UI.', (c) => c.seed('canvas'))
add('color-surface', 'Background of cards, panels, sidebars and inputs that sit on the canvas.', (c) => {
  if (c.hasSeed('surface')) return c.seed('surface')
  const cv = c.seed('canvas')
  return withC(withL(cv, Math.min(1, cv.l + (light(c) ? 0.05 : 0.03))), (x) => x * 0.4)
})
add('color-surface-raised', 'Background of elements lifted above a surface: popovers, hovered cards, menus.', (c) => {
  const s = c.col('color-surface')
  return withL(s, Math.min(1, s.l + (light(c) ? 0.02 : 0.04) + c.dials.elevation * 0.02))
})
add('color-surface-sunken', 'Background of recessed areas such as code blocks, wells and the track of a control.', (c) =>
  mixTo(c.seed('canvas'), c.seed('ink'), 0.04))
add('color-surface-overlay', 'Background of floating layers: dialogs, command palettes, dropdowns.', (c) => c.col('color-surface-raised'))
add('color-scrim', 'Translucent veil dimming the page behind a modal dialog.', (c) => withA(c.seed('ink'), 0.45))

// ── text ───────────────────────────────────────────────────────────────────
add('color-text', 'Primary text colour for body copy and headings.', (c) => c.seed('ink'))
add('color-text-muted', 'Secondary text: captions, descriptions, metadata.', (c) =>
  mixTo(c.seed('ink'), c.col('color-surface'), 0.42 - 0.3 * (c.dials.contrast - 0.5)))
add('color-text-faint', 'Tertiary text: placeholders, disabled labels, timestamps.', (c) =>
  mixTo(c.seed('ink'), c.col('color-surface'), 0.62 - 0.3 * (c.dials.contrast - 0.5)))
add('color-text-on-accent', 'Text and icons placed on a solid accent-coloured background such as a primary button.', (c) =>
  onColour(c.seed('accent')))
add('color-link', 'Colour of inline hyperlinks.', (c) => c.seed('accent'))

// ── lines ──────────────────────────────────────────────────────────────────
add('color-border', 'Default hairline border around cards, inputs and tables.', (c) =>
  mixTo(c.seed('ink'), c.seed('canvas'), 0.86 - 0.2 * (c.dials.borders - 0.5)))
add('color-border-strong', 'Emphasised border: hovered inputs, selected outlines, separators that must stand out.', (c) =>
  mixTo(c.seed('ink'), c.seed('canvas'), 0.74 - 0.2 * (c.dials.borders - 0.5)))
add('color-divider', 'Faint rule between rows or sections inside a single surface.', (c) =>
  mixTo(c.col('color-border'), c.seed('canvas'), 0.4))
add('color-focus', 'Keyboard focus ring; kept visible against the canvas.', (c) =>
  fitLightness(c.seed('accent'), c.seed('canvas'), 3.05))

// ── accent / secondary ─────────────────────────────────────────────────────
function emphasis(prefix: 'accent' | 'secondary', what: string): void {
  const base = (c: DeriveCtx): Oklch => c.col(`color-${prefix}`)
  add(`color-${prefix}-hover`, `Hover state of ${what} backgrounds.`, (c) =>
    withL(base(c), base(c).l + (light(c) ? -0.04 : 0.04)))
  add(`color-${prefix}-active`, `Pressed state of ${what} backgrounds.`, (c) =>
    withL(base(c), base(c).l + (light(c) ? -0.08 : 0.08)))
  add(`color-${prefix}-wash`, `Very light tint of the ${prefix} colour for selected rows, badges and highlighted regions.`, (c) =>
    mixTo(base(c), c.seed('canvas'), light(c) ? 0.9 : 0.85))
  add(`color-${prefix}-text`, `The ${prefix} colour adjusted to be readable as text on a surface (4.5:1).`, (c) =>
    fitLightness(base(c), c.col('color-surface'), 4.55))
}
add('color-accent', 'The brand/action colour: primary buttons, active tabs, key highlights.', (c) => c.seed('accent'))
emphasis('accent', 'accent-coloured controls')
add('color-secondary', 'Supporting colour for secondary actions and contrasting emphasis.', (c) => {
  if (c.hasSeed('secondary')) return c.seed('secondary')
  const a = c.seed('accent')
  return withC(withH(a, a.h + 40), (x) => x * 0.9)
})
emphasis('secondary', 'secondary-coloured controls')

// ── status ─────────────────────────────────────────────────────────────────
const STATUS: [string, number, string][] = []
STATUS.push(
  ['good', 145, 'success, correct answers and positive change'],
  ['bad', 30, 'errors, wrong answers and destructive actions'],
  ['warn', 85, 'warnings and things needing attention'],
  ['info', 240, 'neutral information and hints'],
)
for (const [name, hue, what] of STATUS) {
  const key = name as 'good' | 'bad' | 'warn' | 'info'
  add(`color-${name}`, `Status colour for ${what}.`, (c) => {
    if (c.hasSeed(key)) return c.seed(key)
    const a = c.seed('accent')
    const [lo, hi] = light(c) ? [0.5, 0.7] : [0.65, 0.8]
    return ok(clamp(a.l, lo, hi), clamp(a.c, 0.1, 0.16), pullHue(hue, a.h))
  })
  add(`color-${name}-wash`, `Pale background tint for ${what} banners and badges.`, (c) =>
    mixTo(c.col(`color-${name}`), c.seed('canvas'), light(c) ? 0.9 : 0.85))
  add(`color-${name}-text`, `The ${name} colour adjusted to read as text on a surface (4.5:1).`, (c) =>
    fitLightness(c.col(`color-${name}`), c.col('color-surface'), 4.55))
}

// ── data ───────────────────────────────────────────────────────────────────
for (let i = 0; i < 8; i++) {
  add(`color-series-${i + 1}`, `Categorical data colour ${i + 1} of 8 for chart series, graph nodes and tags; all are legible on a surface.`, (c) => {
    const seeded = c.seriesSeed(i)
    if (seeded) return seeded
    const h = c.seed('accent').h + i * 137.508
    return fitLightness(ok(light(c) ? 0.62 : 0.72, 0.12, h), c.col('color-surface'), 3.05)
  })
}
for (let i = 0; i < 5; i++) {
  add(`color-heat-${i}`, `Heatmap / intensity ramp step ${i} of 4, from the border colour (none) to the accent (most).`, (c) =>
    mixTo(c.col('color-border'), c.seed('accent'), i / 4))
}

// ── interaction / marks ────────────────────────────────────────────────────
add('color-selection', 'Background of selected text and selected ranges.', (c) => withA(c.seed('accent'), 0.25))
const HIGHLIGHT_HUES = [95, 145, 240, 350]
HIGHLIGHT_HUES.forEach((h, i) => {
  add(`color-highlight-${i + 1}`, `Marker-pen highlight ${i + 1} of 4 for annotating text (yellow, green, blue, pink families).`, (c) =>
    mixTo(ok(light(c) ? 0.85 : 0.45, 0.1, h), c.seed('canvas'), 0.2))
})
add('color-shadow', 'Colour of drop shadows; always translucent.', (c) => withA(c.seed('ink'), light(c) ? 0.18 : 0.5))

// ── syntax ─────────────────────────────────────────────────────────────────
const SYNTAX: [string, number][] = [['keyword', 300], ['string', 145], ['number', 55], ['function', 240], ['type', 190]]
for (const [name, hue] of SYNTAX) {
  add(`color-syntax-${name}`, `Code syntax colour for ${name} tokens, readable on a surface.`, (c) =>
    fitLightness(ok(light(c) ? 0.55 : 0.75, 0.12, hue), c.col('color-surface'), 4.55))
}
add('color-syntax-comment', 'Code syntax colour for comments.', (c) => c.col('color-text-faint'))
add('color-syntax-operator', 'Code syntax colour for operators.', (c) => c.col('color-text-muted'))
add('color-syntax-punctuation', 'Code syntax colour for punctuation and brackets.', (c) => c.col('color-text-muted'))

export const COLOUR_TOKENS: TokenDef[] = tokens
