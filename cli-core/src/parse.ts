import type { Parsed } from './types.js'

// Split a command line into tokens and flags. Double or single quotes group
// words; `--flag` and `--flag=value` become flags; a trailing space leaves an
// empty final token so completion knows a new argument has begun.
export function tokenize(input: string): Parsed {
  const tokens: string[] = []
  const flags: Record<string, string | true> = {}
  let cur = ''
  let quote: string | null = null
  let hasToken = false
  const push = () => {
    if (!hasToken) return
    if (cur.startsWith('--') && cur.length > 2) {
      const eq = cur.indexOf('=')
      if (eq > 2) flags[cur.slice(2, eq)] = cur.slice(eq + 1)
      else flags[cur.slice(2)] = true
    } else {
      tokens.push(cur)
    }
    cur = ''
    hasToken = false
  }
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      hasToken = true
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
      continue
    }
    if (ch === ' ' || ch === '\t') {
      push()
      continue
    }
    cur += ch
    hasToken = true
  }
  push()
  if (/[ \t]$/.test(input) && !quote) tokens.push('')
  return { tokens, flags }
}

// A friendly one-line form for help output.
export function usage(path: string[], args: { name: string; optional?: boolean; rest?: boolean }[] = []): string {
  const a = args.map((x) => {
    const inner = x.rest ? `${x.name}…` : x.name
    return x.optional ? `[${inner}]` : `<${inner}>`
  })
  return [...path, ...a].join(' ')
}
