import { defaultConfig } from './config'
import { isConfigLine, parseConfigLine } from './parseConfig'
import { parseStatement } from './parseStatement'
import type { ParseResult } from './types'

// Parses the full spec text: one statement (or "@key: value" config
// directive) per non-empty, non-comment-only line. Errors on individual
// lines are collected rather than thrown, so one bad line doesn't blank out
// the rest of the scene while editing live.
export function parseSpec(text: string): ParseResult {
  const result: ParseResult = { statements: [], statementLines: [], errors: [], config: defaultConfig() }
  const lines = text.split('\n')
  // @angle decides how space's directives read trig in their constants
  // ("@param a = sin(30) …"), wherever it appears, and the last one wins for
  // the whole spec: every @angle line is applied first, and the angle that
  // leaves is held for the loop below, which parses each line in order (and
  // so reports a bad @angle) without letting an earlier @angle change it.
  for (const line of lines) {
    const trimmed = line.split('#')[0].trim()
    if (/^@angle\s*:/.test(trimmed)) {
      try {
        parseConfigLine(trimmed, result.config)
      } catch {
        // reported by the loop below
      }
    }
  }
  const angle = result.config.angle
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].split('#')[0].trim()
    if (trimmed.length === 0) continue
    try {
      if (isConfigLine(trimmed)) {
        parseConfigLine(trimmed, result.config, i + 1)
        result.config.angle = angle
      } else {
        result.statements.push(parseStatement(lines[i]))
        result.statementLines.push(i + 1)
      }
    } catch (err) {
      result.errors.push({ line: i + 1, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
