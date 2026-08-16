export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '=' | ',' | '(' | ')' | '[' | ']' }

const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'ln', 'exp'])

export function isFunctionName(name: string): boolean {
  return FUNCTION_NAMES.has(name)
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < input.length && ((input[j] >= '0' && input[j] <= '9') || input[j] === '.')) j++
      tokens.push({ kind: 'num', value: Number.parseFloat(input.slice(i, j)) })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++
      tokens.push({ kind: 'ident', name: input.slice(i, j) })
      i = j
      continue
    }
    if ('+-*/^=,()[]'.includes(c)) {
      tokens.push({ kind: 'op', value: c as '+' | '-' | '*' | '/' | '^' | '=' | ',' | '(' | ')' | '[' | ']' })
      i++
      continue
    }
    throw new Error(`Unexpected character "${c}" at position ${i}`)
  }
  return tokens
}
