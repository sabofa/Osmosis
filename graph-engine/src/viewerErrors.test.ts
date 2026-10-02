import { describe, expect, it, vi } from 'vitest'
import { parseSpec } from './parser/parseSpec'
import { buildScene } from './scene/buildScene'
import { createErrorReporter, sameErrors } from './viewerErrors'

describe('sameErrors', () => {
  it('compares line and message, in order', () => {
    expect(sameErrors([], [])).toBe(true)
    expect(sameErrors([{ line: 1, message: 'a' }], [{ line: 1, message: 'a' }])).toBe(true)
    expect(sameErrors([{ line: 1, message: 'a' }], [{ line: 2, message: 'a' }])).toBe(false)
    expect(sameErrors([{ line: 1, message: 'a' }], [{ line: 1, message: 'b' }])).toBe(false)
    expect(sameErrors([{ line: 1, message: 'a' }], [])).toBe(false)
    expect(
      sameErrors(
        [
          { line: 1, message: 'a' },
          { line: 2, message: 'b' },
        ],
        [
          { line: 2, message: 'b' },
          { line: 1, message: 'a' },
        ]
      )
    ).toBe(false)
  })
})

describe('the viewer error reporter', () => {
  it('a text rebuild always delivers, even an unchanged list', () => {
    const deliver = vi.fn()
    const reporter = createErrorReporter(deliver)
    reporter.report([])
    reporter.report([])
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('a view change delivers only when the list differs from the last delivered', () => {
    const deliver = vi.fn()
    const reporter = createErrorReporter(deliver)
    reporter.report([])
    reporter.reportIfChanged([])
    reporter.reportIfChanged([])
    expect(deliver).toHaveBeenCalledTimes(1)
    const note = [{ line: 1, message: 'this curve is undefined everywhere in view' }]
    reporter.reportIfChanged(note)
    reporter.reportIfChanged([{ ...note[0] }])
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(deliver).toHaveBeenLastCalledWith(note)
    reporter.reportIfChanged([])
    expect(deliver).toHaveBeenCalledTimes(3)
    expect(deliver).toHaveBeenLastCalledWith([])
  })

  it('a text rebuild resets what a later view change compares against', () => {
    const deliver = vi.fn()
    const reporter = createErrorReporter(deliver)
    const note = [{ line: 1, message: 'm' }]
    reporter.report(note)
    reporter.reportIfChanged(note)
    expect(deliver).toHaveBeenCalledTimes(1)
    reporter.report([])
    reporter.reportIfChanged(note)
    expect(deliver).toHaveBeenCalledTimes(3)
  })

  it('delivers the note for y = ln(x) as the view pans off its domain and back, with parse errors first', () => {
    // The scenario the viewer's pan/zoom path has to report: nothing is
    // delivered on a frame that changes nothing, and the note follows the view.
    const parsed = parseSpec('y = ln(x)\ny = ?')
    expect(parsed.errors).toHaveLength(1)
    const deliver = vi.fn()
    const reporter = createErrorReporter(deliver)
    const frame = (xMin: number, xMax: number, onViewChange: boolean) => {
      const scene = buildScene(parsed.statements, { xMin, xMax, yMin: -6, yMax: 6 }, parsed.config, undefined, parsed.statementLines)
      const errors = [...parsed.errors, ...scene.errors]
      if (onViewChange) reporter.reportIfChanged(errors)
      else reporter.report(errors)
      return errors
    }
    frame(-10, 10, false)
    expect(deliver).toHaveBeenCalledTimes(1)
    frame(-9, 11, true)
    expect(deliver).toHaveBeenCalledTimes(1)
    const off = frame(-20, -5, true)
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(off).toEqual([parsed.errors[0], expect.objectContaining({ line: 1, message: expect.stringContaining('undefined everywhere in view') })])
    frame(-21, -6, true)
    expect(deliver).toHaveBeenCalledTimes(2)
    frame(-10, 10, true)
    expect(deliver).toHaveBeenCalledTimes(3)
    expect(deliver).toHaveBeenLastCalledWith(parsed.errors)
  })
})
