import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { deepen, deepenFrom, toOklch } from '../style/color'
import { blendOver, drawnContrast } from '../style/theme/contrast'
import { renderFigure } from './render'

// The colour of a fill's marks, on any page.
//
// A fill's shading (hatching, scribbles, dots) is the region's colour DEEPENED, and deepening goes AWAY
// FROM THE PAGE: darker on a light page, lighter on a dark one. It used to go darker everywhere, which on a
// blackboard drew dark brown hatching that all but vanished. In a medium the fill and shading roles are the
// medium's own colours; they and the marks the fill draws itself (the tint, a wash's rim) are held to be
// VISIBLE (a floor of 1.5:1 as drawn against the page). Fills are backdrop, exempt from the floors a line
// keeps, but never invisible.

const SPEC = EXAMPLES.find((e) => e.label === 'Circle vocabulary')!.spec

const FILL_TYPES = ['hatch', 'crosshatch', 'scribble', 'stipple', 'flat', 'wash'] as const

const FLOOR = 1.5

function draw(head: readonly string[], dark = false): string {
  const parsed = parseSpec([...head, SPEC].join('\n'))
  expect(parsed.errors).toEqual([])
  const result = renderFigure(parsed.statements, parsed.config, dark ? DARK_PALETTE : LIGHT_PALETTE)
  expect(result.errors).toEqual([])
  return result.svg
}

const paperOf = (svg: string) => /<g data-layer="paper"><rect[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)![1]

// The marks a fill draws, each with the colour and the opacity it is laid at (its own, times the groups
// around it): hatching and scribble strokes, stipple dots, the flat tint and a wash's rim. The chalk's loose
// dust (a path filled and not stroked, drawn beside a stroke) is texture, not a mark of the fill, and a
// region's own outline is a line: neither is counted.
interface Mark {
  kind: 'stroke' | 'dots' | 'tint' | 'rim'
  hex: string
  opacity: number
}

function marks(svg: string): Mark[] {
  const start = svg.indexOf('<g data-layer="regions"')
  const next = svg.indexOf('<g data-layer="', start + 1)
  const layer = svg.slice(start, next < 0 ? undefined : next)
  const out: Mark[] = []
  const groups: { clip: boolean; opacity: number }[] = []
  for (const m of layer.matchAll(/<(\/?)(g|path|polygon)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClosing] = m
    if (tag === 'g') {
      if (closing) groups.pop()
      else if (!selfClosing) groups.push({ clip: /clip-path=/.test(attrs), opacity: Number(/(?<![-\w])opacity="([0-9.]+)"/.exec(attrs)?.[1] ?? 1) })
      continue
    }
    if (closing) continue
    const inClip = groups.some((g) => g.clip)
    const around = groups.reduce((product, g) => product * g.opacity, 1)
    const own = Number(/(?<![-\w])opacity="([0-9.]+)"/.exec(attrs)?.[1] ?? 1)
    const stroke = /\bstroke="(#[0-9a-f]{6})"/.exec(attrs)?.[1]
    const fill = /\bfill="(#[0-9a-f]{6})"/.exec(attrs)?.[1]
    const fillOpacity = /\bfill-opacity="([0-9.]+)"/.exec(attrs)?.[1]
    if (fillOpacity !== undefined && fill !== undefined) out.push({ kind: 'tint', hex: fill, opacity: Number(fillOpacity) * around })
    else if (inClip && /\bfilter="/.test(attrs) && stroke !== undefined && /\bfill="none"/.test(attrs)) out.push({ kind: 'rim', hex: stroke, opacity: own * around })
    else if (inClip && stroke !== undefined && /\bfill="none"/.test(attrs)) out.push({ kind: 'stroke', hex: stroke, opacity: own * around })
    // A line type that draws a ribbon (ink, the marker) writes its stroke as a polygon.
    else if (inClip && tag === 'polygon' && fill !== undefined) out.push({ kind: 'stroke', hex: fill, opacity: own * around })
    else if (inClip && fill !== undefined && /\bstroke="none"/.test(attrs) && /d="M [-\d.]+ [-\d.]+ a /.test(attrs)) out.push({ kind: 'dots', hex: fill, opacity: own * around })
  }
  return out
}

describe('a fill on a board', () => {
  for (const board of ['blackboard', 'greenboard', 'whiteboard'] as const) {
    for (const fill of FILL_TYPES) {
      it(`${fill} on a ${board}: every mark shows against the board, as drawn`, () => {
        const svg = draw([`@style: ${board}`, `@style-fill: ${fill}`])
        const surface = paperOf(svg)
        // The marks a reader is meant to see: not a wash's rim (a blurred edge), and not the dots that
        // are not the fill's own (the chalk's dust, a marker's pooled ends: texture beside a stroke).
        const found = marks(svg).filter((m) => m.kind !== 'rim' && (m.kind !== 'dots' || fill === 'stipple'))
        expect(found.length, 'the fill draws something').toBeGreaterThan(0)
        for (const mark of found) {
          expect(drawnContrast(mark.hex, surface, mark.opacity), `${mark.kind} ${mark.hex} at ${mark.opacity} on ${surface}`).toBeGreaterThanOrEqual(FLOOR)
        }
      })
    }
  }

  for (const board of ['blackboard', 'greenboard'] as const) {
    for (const fill of FILL_TYPES) {
      it(`${fill} on a ${board}: the marks are lighter than the board, drawn and undrawn`, () => {
        const svg = draw([`@style: ${board}`, `@style-fill: ${fill}`])
        const surface = paperOf(svg)
        for (const mark of marks(svg)) {
          expect(toOklch(mark.hex).l, `${mark.kind} ${mark.hex}`).toBeGreaterThan(toOklch(surface).l)
          expect(toOklch(blendOver(mark.hex, surface, mark.opacity)).l, `${mark.kind} drawn`).toBeGreaterThan(toOklch(surface).l)
        }
      })
    }
  }

  it('draws a board the same in the app’s light and dark, fills included', () => {
    for (const board of ['blackboard', 'greenboard', 'whiteboard']) {
      expect(draw([`@style: ${board}`], true)).toBe(draw([`@style: ${board}`]))
    }
  })

  it('lays the chalk’s hatching in a light pastel, not a dim brown: the blackboard’s hatching reads at 3:1 or better as drawn', () => {
    // Chalk is knocked out in patches (its texture takes about half of a thin stroke), so the hatching of
    // a dark board is held to more than the bare floor.
    for (const board of ['blackboard', 'greenboard']) {
      const svg = draw([`@style: ${board}`, '@style-fill: hatch'])
      const surface = paperOf(svg)
      for (const mark of marks(svg).filter((m) => m.kind === 'stroke')) {
        expect(drawnContrast(mark.hex, surface, mark.opacity), `${board} ${mark.hex}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('a fill in the clean medium on a dark paper', () => {
  // The clean medium draws the host palette's colours; the paper is a board's colour. The shading was the
  // region's colour deepened (darker): dark brown on slate.
  for (const board of ['blackboard', 'greenboard'] as const) {
    for (const fill of ['hatch', 'crosshatch', 'stipple'] as const) {
      it(`${fill} on a ${board} is lighter than the board and shows against it`, () => {
        const svg = draw(['@style: clean', `@style-fill: ${fill}`, `@style-paper: ${board}`])
        const surface = paperOf(svg)
        const found = marks(svg)
        expect(found.length).toBeGreaterThan(0)
        for (const mark of found) {
          expect(toOklch(mark.hex).l, `${mark.hex}`).toBeGreaterThan(toOklch(surface).l)
          expect(drawnContrast(mark.hex, surface, mark.opacity), `${mark.hex} at ${mark.opacity}`).toBeGreaterThanOrEqual(FLOOR)
        }
      })
    }
  }
})

describe('a fill on a light paper', () => {
  it('keeps the clean medium’s shading exactly as it was: the region’s colour times 0.7 in lightness', () => {
    // The pins of the preset goldens say the same for ink, pencil and marker; this is the clean medium's own.
    const flat = marks(draw(['@style: clean', '@style-fill: flat']))
    const tint = flat.find((m) => m.kind === 'tint')!
    const hatch = marks(draw(['@style: clean', '@style-fill: hatch'])).find((m) => m.kind === 'stroke')!
    expect(hatch.hex).toBe(deepen(tint.hex, 0.7))
    expect(hatch.hex).toBe('#7e3200')
  })

  it('keeps ink hatching as it was', () => {
    const hatch = marks(draw(['@style: ink', '@style-fill: hatch'])).find((m) => m.kind === 'stroke')!
    expect(hatch.hex).toBe('#8e4015')
    expect(hatch.opacity).toBeCloseTo(0.65, 3)
  })
})

describe('deepenFrom', () => {
  it('darkens on a light page, as deepen does, byte for byte', () => {
    for (const hex of ['#c65d22', '#4c7a4a', '#e9c46a', '#0a0a0a']) {
      expect(deepenFrom(hex, 0.7, '#ffffff')).toBe(deepen(hex, 0.7))
      expect(deepenFrom(hex, 0.7, '#fdf6ea')).toBe(deepen(hex, 0.7))
    }
  })

  it('lightens on a dark page: a third of the way (1 - 0.7) from the colour to white, in lightness', () => {
    for (const hex of ['#c65d22', '#4c7a4a', '#7a6459']) {
      const before = toOklch(hex)
      const after = toOklch(deepenFrom(hex, 0.7, '#1a2930'))
      expect(after.l).toBeGreaterThan(before.l)
      expect(after.l).toBeCloseTo(1 - (1 - before.l) * 0.7, 1)
      expect(Math.abs(after.h - before.h)).toBeLessThan(6)
    }
  })

  it('leaves what is not a colour alone', () => {
    expect(deepenFrom('none', 0.7, '#1a2930')).toBe('none')
    expect(deepenFrom('url(#x)', 0.7, '#ffffff')).toBe('url(#x)')
  })
})
