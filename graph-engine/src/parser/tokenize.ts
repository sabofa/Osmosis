export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '=' | ',' | '(' | ')' | '[' | ']' | '{' | '}' | ':' | '|' | '!' | "'" | '<' | '<=' | '>' | '>=' | '!=' }

type OpValue = (Token & { kind: 'op' })['value']

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
      // Scientific notation, agreed with the solid-figure side: a lowercase
      // "e" is an exponent only when it directly follows the numeral AND is
      // directly followed by an optional sign and a digit ("1e-12", "2e3",
      // "1.5e+6"). Otherwise it stays the constant e or starts a name ("2e",
      // "3e x", "2e^x", "2e-x", "2exp(x)"). An uppercase "E" never is an
      // exponent: "2E3" is 2 times the name E3, since capitals name points
      // and constants.
      if (input[j] === 'e') {
        const sign = input[j + 1] === '+' || input[j + 1] === '-' ? 1 : 0
        const first = input[j + 1 + sign]
        if (first !== undefined && first >= '0' && first <= '9') {
          j += 1 + sign
          while (j < input.length && input[j] >= '0' && input[j] <= '9') j++
        }
      }
      // One literal is one finite number: a second decimal point would be
      // cut off by parseFloat ("1.2.3" -> 1.2), and a literal past the
      // largest double would become Infinity.
      const text = input.slice(i, j)
      if (text.indexOf('.') !== text.lastIndexOf('.')) throw new Error(`${text} has more than one decimal point`)
      const value = Number.parseFloat(text)
      if (!Number.isFinite(value)) throw new Error(`${text} is too large for a number`)
      tokens.push({ kind: 'num', value })
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
    // Comparators and "!": two characters when followed by "=" ("<=", ">=",
    // "!="); a lone "!" is the factorial (calc P1).
    if (c === '<' || c === '>' || c === '!') {
      if (input[i + 1] === '=') {
        tokens.push({ kind: 'op', value: `${c}=` as '<=' | '>=' | '!=' })
        i += 2
        continue
      }
      tokens.push({ kind: 'op', value: c })
      i++
      continue
    }
    if ("+-*/^=,()[]{}:|'".includes(c)) {
      tokens.push({ kind: 'op', value: c as OpValue })
      i++
      continue
    }
    throw new Error(`Unexpected character "${c}" at position ${i}`)
  }
  return tokens
}
