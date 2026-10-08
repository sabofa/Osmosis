import { parseColour } from '../colour.js'
import { def, hex, mixTo, type TokenDef } from './types.js'

const WHITE = parseColour('#ffffff')
const BLACK = parseColour('#000000')
const NOTE = ' Consumed by components (var(--name) or component tokens); does not restyle anything by itself.'

export const MATERIAL_TOKENS: TokenDef[] = [
  def('elevation-mode', 'elevation', 'string',
    'How raised surfaces are drawn: shadow, tonal (lighter fill), hairline, bevel, hard-offset or none.' + NOTE,
    () => 'shadow',
    { modeDependent: false, allowed: ['shadow', 'tonal', 'hairline', 'bevel', 'hard-offset', 'none'] }),
  def('bevel-light', 'elevation', 'color',
    'Highlight edge colour for bevelled surfaces (top/left lip).' + NOTE,
    (c) => hex(mixTo(c.col('color-surface'), WHITE, c.mode === 'light' ? 0.7 : 0.25)),
    { modeDependent: true }),
  def('bevel-dark', 'elevation', 'color',
    'Shadow edge colour for bevelled surfaces (bottom/right lip).' + NOTE,
    (c) => c.mode === 'light'
      ? hex(mixTo(c.col('color-border-strong'), BLACK, 0.35))
      : hex(mixTo(c.col('color-surface'), BLACK, 0.6)),
    { modeDependent: true }),
  def('bevel-depth', 'elevation', 'length',
    'Thickness of the bevel lips when elevation-mode is bevel.' + NOTE,
    () => '2px', { modeDependent: false }),
  def('corner-shape', 'shape', 'string',
    'Corner geometry of panels and controls: round, squircle, bevel, notch, scoop or square.' + NOTE,
    () => 'round',
    { modeDependent: false, allowed: ['round', 'squircle', 'bevel', 'notch', 'scoop', 'square'] }),
  def('icon-sheet', 'shape', 'string',
    "Which icon sheet the frame draws icons from: 'default' (the built-in line icons), 'builtin:<slug>' (a sprite shipped with the app) or 'asset:<hash>' (an uploaded sprite). The frame falls back to the default line icon for any icon name the sheet lacks.",
    () => 'default',
    { modeDependent: false, pattern: /^(default|builtin:[a-z0-9][a-z0-9_-]{0,31}|asset:[0-9a-f]{16,64})$/, patternHint: "'default', 'builtin:<slug>' or 'asset:<hash>'" }),
  def('motion-style', 'motion', 'string',
    'Character of motion: smooth, stepped, none or wiggle.' + NOTE,
    () => 'smooth',
    { modeDependent: false, allowed: ['smooth', 'stepped', 'none', 'wiggle'] }),
]
