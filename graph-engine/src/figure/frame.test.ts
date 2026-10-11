import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { authorToView, figureMapping, viewToAuthorPlane } from './frame'
import { renderFigure } from './render'

// The frame is the figure's own account of where an author's coordinates land.
// Every test below reads the answer off the SVG itself, so the frame cannot
// drift from what is drawn.

function render(spec: string) {
  const parsed = parseSpec(spec)
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

// The centre of the point circle drawn for `object`.
function drawnPoint(svg: string, object: string): { x: number; y: number } {
  for (const tag of svg.match(/<circle[^>]*>/g) ?? []) {
    if (!tag.includes(`data-object="${object}"`)) continue
    return { x: Number(/cx="([^"]+)"/.exec(tag)![1]), y: Number(/cy="([^"]+)"/.exec(tag)![1]) }
  }
  throw new Error(`no point circle for ${object}`)
}

function expectClose(actual: { x: number; y: number } | null, expected: { x: number; y: number }) {
  expect(actual).not.toBeNull()
  expect(actual!.x).toBeCloseTo(expected.x, 3)
  expect(actual!.y).toBeCloseTo(expected.y, 3)
}

describe('the plane frame', () => {
  const { svg, frame } = render('@mode: figure\npolygon: A(0,0), B(4,0), C(1,3)')

  it('is a plane frame', () => {
    expect(frame.kind).toBe('plane')
  })

  it('places each author point where its dot is drawn', () => {
    expectClose(authorToView(frame, { kind: 'plane', x: 0, y: 0 }), drawnPoint(svg, 'A'))
    expectClose(authorToView(frame, { kind: 'plane', x: 4, y: 0 }), drawnPoint(svg, 'B'))
    expectClose(authorToView(frame, { kind: 'plane', x: 1, y: 3 }), drawnPoint(svg, 'C'))
  })

  it('passes a view target through unchanged', () => {
    expect(authorToView(frame, { kind: 'view', u: 12, v: -7 })).toEqual({ x: 12, y: -7 })
  })

  it('refuses a space target', () => {
    expect(authorToView(frame, { kind: 'space', x: 0, y: 0, z: 0 })).toBeNull()
  })

  it('round-trips through viewToAuthorPlane', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: -2.5, y: 7.25 },
    ]) {
      const view = authorToView(frame, { kind: 'plane', ...p })!
      expectClose(viewToAuthorPlane(frame, view), p)
    }
  })

  it('maps through figureMapping the same way', () => {
    const mapping = figureMapping(frame)
    expectClose(mapping.toContent({ kind: 'plane', x: 1, y: 3 }), drawnPoint(svg, 'C'))
    expect(mapping.toContent({ kind: 'space', x: 1, y: 2, z: 3 })).toBeNull()
  })

  it('holds for a figure far from the origin (the centre is exposed, not recomputed)', () => {
    const far = render('@mode: figure\npolygon: A(1000,1000), B(1004,1000), C(1001,1003)')
    expectClose(authorToView(far.frame, { kind: 'plane', x: 1004, y: 1000 }), drawnPoint(far.svg, 'B'))
  })
})

describe('the space frame', () => {
  for (const view of ['standard', 'isometric', 'front', 'top', 'side']) {
    it(`places a point in space where its dot is drawn (${view})`, () => {
      const { svg, frame } = render(`@mode: figure\n@view: ${view}\nS = solid prism 8 by 5 by 6\nP = (1, 2, 3)\nQ = (4, 1, 2)`)
      expect(frame.kind).toBe('space')
      if (frame.kind === 'space') expect(frame.view).toBe(view)
      expectClose(authorToView(frame, { kind: 'space', x: 1, y: 2, z: 3 }), drawnPoint(svg, 'P'))
      expectClose(authorToView(frame, { kind: 'space', x: 4, y: 1, z: 2 }), drawnPoint(svg, 'Q'))
    })
  }

  const { frame } = render('@mode: figure\nS = solid cube edge 4 vertices ABCDEFGH\nnet: S')

  it('is a space frame on a solid figure', () => {
    expect(frame.kind).toBe('space')
  })

  it('passes a view target through unchanged', () => {
    expect(authorToView(frame, { kind: 'view', u: 3, v: 4 })).toEqual({ x: 3, y: 4 })
  })

  it('refuses a plane target, and has no plane inverse', () => {
    expect(authorToView(frame, { kind: 'plane', x: 1, y: 1 })).toBeNull()
    expect(viewToAuthorPlane(frame, { x: 0, y: 0 })).toBeNull()
  })

  it('refuses a plane target in the mapping, and places a space one', () => {
    const mapping = figureMapping(frame)
    expect(mapping.toContent({ kind: 'plane', x: 1, y: 1 })).toBeNull()
    expect(mapping.toContent({ kind: 'space', x: 1, y: 1, z: 1 })).not.toBeNull()
  })
})
