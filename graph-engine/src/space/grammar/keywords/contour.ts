// "contour:" (plan A2; SP9 row 4.1). The grammar is phase S4a's; the builder
// dispatches on the target's arity (kernel/geometry/levelSurfaces.ts):
//
//   contour: <f or expr> levels <n>                    n levels at nice values
//   contour: <f or expr> levels <a>..<b> step <s>      a, a + s, ... up to b
//   contour: <f or expr> levels <a>, <b>, <c>          as written
//   contour: <f or expr> level <c>                     one level
//   ... [floor] [labels] [opacity: ..] [res: ..] [width: ..] [dashed]
//
// The target is a defined function's name ("g") or an inline expression
// ("x^2 + y^2 + z^2"). "floor" projects level curves onto the box floor (two
// variables); "labels" writes each level's value on it. A level's value may
// read parameters.

import { splitTopLevelComma } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import { splitStyle } from '../style'
import type { SpaceForm } from '../types'
import type { Levels } from './geometryForms'
import { keywordStyle } from './shared'

// The most levels one contour asks for (level surfaces have a lower limit of
// their own in the kernel: each is a marching pass over the whole box).
export const MAX_LEVELS = 100

const USAGE = '"contour: g levels 5", "contour: g levels -4..4 step 1" or "contour: g levels 1, 4, 9"'

function parseLevels(word: 'level' | 'levels', text: string): Levels {
  const spec = text.trim()
  if (word === 'level') {
    if (splitTopLevelComma(spec).length > 1 || spec.includes('..')) throw new Error(`"level" takes one value; write several as "levels ${spec}"`)
    return { kind: 'list', values: [parseExprString(spec)] }
  }
  const range = /^(.+?)\.\.(.+)$/.exec(spec)
  if (range) {
    const step = /^(.+?)\s+step\s+(.+)$/.exec(range[2])
    if (!step) throw new Error(`A range of levels needs a step: "levels ${range[1].trim()}..${range[2].trim()} step 1"`)
    return { kind: 'range', from: parseExprString(range[1]), to: parseExprString(step[1]), step: parseExprString(step[2]) }
  }
  const parts = splitTopLevelComma(spec)
  if (parts.length > 1) {
    if (parts.length > MAX_LEVELS) throw new Error(`A contour draws at most ${MAX_LEVELS} levels, got ${parts.length}`)
    return { kind: 'list', values: parts.map((p) => parseExprString(p)) }
  }
  if (/^\d+$/.test(spec)) {
    const n = Number(spec)
    if (n < 1 || n > MAX_LEVELS) throw new Error(`"levels ${spec}" asks for ${n} levels — the count is from 1 to ${MAX_LEVELS}`)
    return { kind: 'count', count: n }
  }
  throw new Error(`"levels ${spec}" is not a count, a list or a range — write ${USAGE}, or "level ${spec}" for one level`)
}

export function parseContour(text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  let body = rest.trim()
  let floor = false
  let labels = false
  for (let flag = /\s+(floor|labels)$/.exec(body); flag; flag = /\s+(floor|labels)$/.exec(body)) {
    if (flag[1] === 'floor') {
      if (floor) throw new Error('"floor" is given twice')
      floor = true
    } else {
      if (labels) throw new Error('"labels" is given twice')
      labels = true
    }
    body = body.slice(0, flag.index).trimEnd()
  }
  const levels = /^(.*?)\s+(levels?)\s+(.+)$/.exec(body)
  if (!levels || levels[1].trim() === '') throw new Error(`Expected ${USAGE}, got "contour: ${text.trim()}"`)
  const targetText = levels[1].trim()
  return {
    form: 'contour',
    target: parseExprString(targetText),
    text: targetText,
    levels: parseLevels(levels[2] as 'level' | 'levels', levels[3]),
    floor,
    labels,
    style: keywordStyle(clauses, ['opacity', 'res', 'width', 'dashed'], 'contour'),
  }
}
