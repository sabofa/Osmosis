import { defaultConfig } from './config'
import { isConfigLine, parseConfigLine } from './parseConfig'
import { parseStatement } from './parseStatement'
import type { ParseResult } from './types'

// Parses the full spec text: one statement (or "@key: value" config
// directive) per non-empty, non-comment-only line. Errors on individual
// lines are collected rather than thrown, so one bad line doesn't blank out
// the rest of the scene while editing live.
export function parseSpec(text: string): ParseResult {
  const result: ParseResult = { statements: [], errors: [], config: defaultConfig() }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].split('#')[0].trim()
    if (trimmed.length === 0) continue
    try {
      if (isConfigLine(trimmed)) {
        parseConfigLine(trimmed, result.config)
      } else {
        result.statements.push(parseStatement(lines[i]))
      }
    } catch (err) {
      result.errors.push({ line: i + 1, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
