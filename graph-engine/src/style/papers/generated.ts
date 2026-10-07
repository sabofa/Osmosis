import { tag } from '../markup'
import { fromOklch } from '../color'
import { randomFor } from '../random'
import { mixOklab } from '../theme/derive'
import type { ThemeInput } from '../theme/types'
import type { GeneratedPaperType } from './generate/types'
import { GENERATED_PAPER_TYPES } from './generate'
import { cover, sheet } from './common'
import { rulingsOf, type Rulings, type Waver } from './rulings'
import type { PaperInput, PaperOutput } from './types'

// The generated papers as SVG (spec 2026-10-02-painted-figures-design.md §5): a flat sheet of the base colour,
// a pattern tile (the generated structure, baked to a bitmap elsewhere and found by its KEY), the hand-drawn
// rulings over it, and, on the dark boards, the dust of the chalk tray. Pure: no DOM, no clock, no Math.random.
// Nothing here makes the bitmap: the `<image>` is left empty, its `data-paper-key` says which tile belongs.

const KEY_VERSION = 'paper-v1'
const BOARDS: readonly GeneratedPaperType[] = ['blackboard', 'greenboard', 'whiteboard']
const DUSTY: readonly GeneratedPaperType[] = ['blackboard', 'greenboard']
const RULINGS: Partial<Record<GeneratedPaperType, Rulings>> = { notebook: 'notebook', graphPaper: 'graph', dotted: 'dotted' }

export function paperKey(type: GeneratedPaperType, seed: number, size: number, texture: number, baseHex: string): string {
  return `${KEY_VERSION}:${type}:${seed}:${size}:${texture}:${baseHex}`
}

export function parsePaperKey(key: string): { type: GeneratedPaperType; seed: number; size: number; texture: number; baseHex: string } | null {
  const parts = key.split(':')
  if (parts.length !== 6 || parts[0] !== KEY_VERSION) return null
  const type = parts[1] as GeneratedPaperType
  if (!GENERATED_PAPER_TYPES.includes(type)) return null
  const [seed, size, texture] = [parts[2], parts[3], parts[4]].map(Number)
  if (![seed, size, texture].every(Number.isFinite)) return null
  if (!/^#[0-9a-f]{6}$/.test(parts[5])) return null
  return { type, seed, size, texture, baseHex: parts[5] }
}

// The colour a paper's tile is recoloured to. A board is the theme's board, whatever the mode; kraft is the
// tint drawn most of the way to a brown; the rest are the tint.
export function paperBaseColour(type: GeneratedPaperType, theme: ThemeInput, tint: string): string {
  if (BOARDS.includes(type)) return theme.boards[type as keyof ThemeInput['boards']].toLowerCase()
  if (type === 'kraft') return mixOklab(tint, fromOklch({ l: 0.62, c: 0.06, h: 70 }), 0.7).toLowerCase()
  return tint.toLowerCase()
}

// The dust a chalk tray lets fall: a soft gradient up from the bottom edge and a seeded scatter of blotches.
function trayDust(type: GeneratedPaperType, input: PaperInput, base: string): PaperOutput {
  const { view, id } = input
  const random = randomFor(`paper-tray:${type}`, input.seed)
  const dust = mixOklab(base, '#ffffff', 0.55)
  const box = cover(view)
  const top = view.y + view.height * 0.86
  const bottom = view.y + view.height
  const gradient = id('tray')
  const defs = [
    tag('linearGradient', { id: gradient, x1: 0, y1: 0, x2: 0, y2: 1 }, [
      tag('stop', { offset: 0, 'stop-color': dust, 'stop-opacity': 0 }),
      tag('stop', { offset: 1, 'stop-color': dust, 'stop-opacity': 0.22 }),
    ]),
  ]
  const blotches: string[] = []
  for (let i = 0; i < 46; i++) {
    blotches.push(
      tag('ellipse', {
        cx: view.x + random.range(-0.1, 1.1) * view.width,
        cy: top + random.range(0.2, 1.05) * (bottom - top),
        rx: random.range(0.01, 0.05) * view.width,
        ry: random.range(0.004, 0.018) * view.height,
        fill: dust,
        opacity: random.range(0.04, 0.16),
      })
    )
  }
  const band = tag('rect', { x: box.x, y: top, width: box.width, height: bottom - top, fill: `url(#${gradient})` })
  return { defs, background: [tag('g', { 'data-paper': 'tray' }, [band, ...blotches])] }
}

export function generatedPaper(type: GeneratedPaperType, input: PaperInput, waver: Waver = 'slight'): PaperOutput {
  const size = input.settings.tile
  const texture = input.settings.texture
  // A board is the theme's board, unless the author named a tint of their own: that wins (as paperColour has it).
  const own = BOARDS.includes(type) && input.settings.tint !== 'theme'
  const base = own ? input.tint.toLowerCase() : paperBaseColour(type, input.theme, input.tint)
  const key = paperKey(type, input.seed, size, texture, base)
  const pattern = input.id('tile')
  const defs = [
    tag('pattern', { id: pattern, 'data-paper-key': key, width: size, height: size, patternUnits: 'userSpaceOnUse' }, [
      tag('image', { 'data-paper-key': key, href: '', width: size, height: size }),
    ]),
  ]
  const background = [sheet(input.view, base), sheet(input.view, `url(#${pattern})`)]

  const rulings = RULINGS[type]
  if (rulings) {
    // Its own seeded hand, so the same paper rules the same way whoever draws it first.
    const laid = rulingsOf(rulings, waver, { ...input, tint: base, random: randomFor(`paper-rules:${type}`, input.seed) })
    defs.push(...laid.defs)
    background.push(...laid.background)
  }
  if (DUSTY.includes(type)) {
    const laid = trayDust(type, input, base)
    defs.push(...laid.defs)
    background.push(...laid.background)
  }
  return { defs, background }
}

// The distinct keys in some SVG, in order of first appearance.
export function paperKeysIn(svg: string): string[] {
  const seen = new Set<string>()
  for (const match of svg.matchAll(/data-paper-key="([^"]+)"/g)) seen.add(match[1])
  return [...seen]
}
