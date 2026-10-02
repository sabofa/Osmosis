import { BUILTIN_NAMES } from '../math/compile'
import { call, variable } from '../math/expr'
import { and, compare, factorialOf, integral, MAX_PRIME_ORDER, not, or, piecewise, prime, prod, sum, type ComparisonOp } from '../math/reserved'
import { tokenize, type Token } from './tokenize'
import type { Expr } from './types'

// "^-1" on these names means the inverse function, as textbooks write it.
const INVERSES: Readonly<Record<string, string>> = { sin: 'asin', cos: 'acos', tan: 'atan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' }
const NO_INVERSE: Readonly<Record<string, string>> = { sec: 'acos(1/x)', csc: 'asin(1/x)', cot: 'atan(1/x)' }

const COMPARISONS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '=', '!='])

class ExprParser {
  private tokens: Token[]
  private pos = 0
  // Inside |…|: a bar after an operand closes rather than multiplies.
  private absDepth = 0
  // Words that end an operand here instead of multiplying it: "to" inside a
  // sum's bounds, "and"/"or" inside a condition. Empty everywhere else, so a
  // variable named "to" still multiplies as it always did.
  private stops: string[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private next(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('Unexpected end of expression')
    this.pos++
    return t
  }

  private isOp(t: Token | undefined, value: string): t is Token & { kind: 'op' } {
    return !!t && t.kind === 'op' && t.value === value
  }

  private isWord(word: string): boolean {
    const t = this.peek()
    return !!t && t.kind === 'ident' && t.name === word
  }

  private isComparison(t: Token | undefined): t is Token & { kind: 'op' } {
    return !!t && t.kind === 'op' && COMPARISONS.has(t.value)
  }

  // Parentheses, call arguments, braces and bars start a fresh context: no
  // stop words, no open bar.
  private fresh<T>(run: () => T): T {
    const stops = this.stops
    const depth = this.absDepth
    this.stops = []
    this.absDepth = 0
    try {
      return run()
    } finally {
      this.stops = stops
      this.absDepth = depth
    }
  }

  private stoppingAt<T>(words: string[], run: () => T): T {
    const before = this.stops
    this.stops = [...before, ...words]
    try {
      return run()
    } finally {
      this.stops = before
    }
  }

  private startsImplicitFactor(t: Token | undefined): boolean {
    if (!t) return false
    if (t.kind === 'num') return true
    if (t.kind === 'ident') return !this.stops.includes(t.name)
    if (t.value === '(' || t.value === '{') return true
    if (t.value === '|') return this.absDepth === 0
    return false
  }

  // expr := term (('+'|'-') term)*
  parseExpr(): Expr {
    let left = this.parseTerm()
    while (this.isOp(this.peek(), '+') || this.isOp(this.peek(), '-')) {
      const op = this.next() as Token & { kind: 'op' }
      const right = this.parseTerm()
      left = { kind: 'binary', op: op.value as '+' | '-', left, right }
    }
    return left
  }

  // term := unary (('*'|'/') unary | <implicit multiplication>)*
  private parseTerm(): Expr {
    let left = this.parseUnary()
    for (;;) {
      if (this.isOp(this.peek(), '*') || this.isOp(this.peek(), '/')) {
        const op = this.next() as Token & { kind: 'op' }
        const right = this.parseUnary()
        left = { kind: 'binary', op: op.value as '*' | '/', left, right }
      } else if (this.startsImplicitFactor(this.peek())) {
        // implicit multiplication: "2x", "3(x+1)", "2 sin(x)", "2|x|"
        const right = this.parseUnary()
        left = { kind: 'binary', op: '*', left, right }
      } else {
        break
      }
    }
    return left
  }

  // unary := '-' unary | power
  //
  // Sits ABOVE power so unary minus binds looser than "^": "-2^2" is -(2^2) =
  // -4, as every standard reference reads it, and "y = -x^2" opens downward.
  private parseUnary(): Expr {
    if (this.isOp(this.peek(), '-')) {
      this.next()
      return { kind: 'unary', op: '-', arg: this.parseUnary() }
    }
    return this.parsePower()
  }

  // power := postfix ('^' unary)?  (right-associative; the exponent side
  // recurses through unary so "2^-1" parses)
  private parsePower(): Expr {
    const base = this.parsePostfix()
    if (this.isOp(this.peek(), '^')) {
      this.next()
      const exp = this.parseUnary()
      return { kind: 'binary', op: '^', left: base, right: exp }
    }
    return base
  }

  // postfix := primary '!'*   ("!" binds tighter than "^" and unary minus)
  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    while (this.isOp(this.peek(), '!')) {
      this.next()
      e = factorialOf(e)
    }
    return e
  }

  private parseArgs(name: string): Expr[] {
    this.next() // (
    return this.fresh(() => {
      const args: Expr[] = []
      if (!this.isOp(this.peek(), ')')) {
        args.push(this.parseExpr())
        while (this.isOp(this.peek(), ',')) {
          this.next()
          args.push(this.parseExpr())
        }
      }
      if (!this.isOp(this.peek(), ')')) throw new Error(`Expected ")" after arguments to "${name}"`)
      this.next()
      return args
    })
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (!t) throw new Error('Unexpected end of expression')

    if (t.kind === 'num') {
      this.next()
      return { kind: 'num', value: t.value }
    }

    if (t.kind === 'ident') {
      this.next()
      const name = t.name
      if ((name === 'sum' || name === 'prod' || name === 'integral') && this.isOp(this.peek(), '(') && this.peek(1)?.kind === 'ident' && this.isOp(this.peek(2), '=')) {
        return this.parseBinder(name)
      }
      if (this.isOp(this.peek(), "'")) return this.parsePrime(name)
      if (BUILTIN_NAMES.has(name) && this.isOp(this.peek(), '^')) return this.parseFunctionPower(name)
      // Not validated against the built-ins here: a call to a user function
      // looks identical, and definitions may come anywhere in the spec.
      // math/compile.ts resolves both, and reads "x(x + 1)" as a product when
      // x is a value.
      if (this.isOp(this.peek(), '(')) return call(name, ...this.parseArgs(name))
      return variable(name)
    }

    if (this.isOp(t, '(')) {
      this.next()
      const inner = this.fresh(() => this.parseExpr())
      if (!this.isOp(this.peek(), ')')) throw new Error('Expected ")"')
      this.next()
      return inner
    }

    if (this.isOp(t, '|')) {
      this.next()
      const inner = this.fresh(() => {
        this.absDepth = 1
        return this.parseExpr()
      })
      if (!this.isOp(this.peek(), '|')) throw new Error('Expected a closing "|"')
      this.next()
      return call('abs', inner)
    }

    if (this.isOp(t, '{')) {
      this.next()
      return this.fresh(() => this.parsePiecewise())
    }

    throw new Error(`Unexpected token in expression`)
  }

  // f'(x), f''(x), …
  private parsePrime(name: string): Expr {
    let order = 0
    while (this.isOp(this.peek(), "'")) {
      this.next()
      order++
    }
    const written = `${name}${"'".repeat(order)}`
    if (order > MAX_PRIME_ORDER) throw new Error(`At most ${MAX_PRIME_ORDER} primes: "${written}"`)
    if (!this.isOp(this.peek(), '(')) throw new Error(`"${written}" needs its argument: ${written}(x)`)
    return prime(name, order, this.parseArgs(written))
  }

  // sin^2(x) is (sin x)^2; sin^-1(x) is asin(x).
  private parsePowerExponentIsMinusOne(e: Expr): boolean {
    return (e.kind === 'unary' && e.arg.kind === 'num' && e.arg.value === 1) || (e.kind === 'num' && e.value === -1)
  }

  private parseFunctionPower(name: string): Expr {
    this.next() // ^
    const power = this.parseUnary()
    // No argument list: not a function power. The name is a variable raised to
    // the power it always was ("gamma^2" with @param gamma = 2, "step^k"), a
    // tree that parsed before this form existed, so it still parses to it.
    // (The exponent just read is the whole of it: nothing follows a unary that
    // a power or a "!" could still take.)
    if (!this.isOp(this.peek(), '(')) return { kind: 'binary', op: '^', left: variable(name), right: power }
    const args = this.parseArgs(name)
    if (this.parsePowerExponentIsMinusOne(power)) {
      const inverse = INVERSES[name]
      if (inverse) return call(inverse, ...args)
      const instead = NO_INVERSE[name]
      if (instead) throw new Error(`"${name}^-1" has no built-in; write ${instead}`)
    }
    return { kind: 'binary', op: '^', left: call(name, ...args), right: power }
  }

  // sum(k = a to b, body), prod(…), integral(t = a to b, body)
  private parseBinder(name: 'sum' | 'prod' | 'integral'): Expr {
    this.next() // (
    return this.fresh(() => {
      const bound = this.next() as Token & { kind: 'ident' }
      this.next() // =
      const lo = this.stoppingAt(['to'], () => this.parseExpr())
      if (!this.isWord('to')) throw new Error(`Expected "to" in ${name}(${bound.name} = a to b, …)`)
      this.next()
      const hi = this.parseExpr()
      if (!this.isOp(this.peek(), ',')) throw new Error(`Expected "," after the bounds in ${name}(${bound.name} = a to b, …)`)
      this.next()
      const body = this.parseExpr()
      if (!this.isOp(this.peek(), ')')) throw new Error(`Expected ")" to close ${name}(…)`)
      this.next()
      const make = name === 'sum' ? sum : name === 'prod' ? prod : integral
      return make(bound.name, lo, hi, body)
    })
  }

  // {c1: v1, c2: v2, …, otherwise}
  private parsePiecewise(): Expr {
    const pieces: [Expr, Expr][] = []
    let otherwise: Expr | null = null
    for (;;) {
      if (otherwise) throw new Error('Only the last piece of a piecewise definition may be a bare value (the "otherwise")')
      const piece = this.parseConditionOrExpr()
      if (piece.condition) {
        if (!this.isOp(this.peek(), ':')) throw new Error('Expected ":" after a piece\'s condition, as in {x < 0: x^2, 5}')
        this.next()
        pieces.push([piece.expr, this.parseExpr()])
      } else {
        if (this.isOp(this.peek(), ':')) throw new Error("A piece's condition must be a comparison, as in {x < 0: x^2}")
        otherwise = piece.expr
      }
      if (this.isOp(this.peek(), ',')) {
        this.next()
        continue
      }
      if (this.isOp(this.peek(), '}')) {
        this.next()
        break
      }
      throw new Error('Expected "," or "}" in a piecewise definition')
    }
    if (pieces.length === 0) throw new Error('A piecewise definition needs at least one "condition: value" piece')
    return piecewise(pieces, otherwise)
  }

  private parseOperand(): Expr {
    return this.stoppingAt(['and', 'or'], () => this.parseExpr())
  }

  // condition := conj ('or' conj)*; conj := neg ('and' neg)*;
  // neg := 'not' neg | chain; chain := operand (cmp operand)+
  parseCondition(): Expr {
    let left = this.parseConj()
    while (this.isWord('or')) {
      this.next()
      left = or(left, this.parseConj())
    }
    return left
  }

  private parseConj(): Expr {
    let left = this.parseNeg()
    while (this.isWord('and')) {
      this.next()
      left = and(left, this.parseNeg())
    }
    return left
  }

  private parseNeg(): Expr {
    if (this.isWord('not')) {
      this.next()
      return not(this.parseNeg())
    }
    return this.parseChainFrom(this.parseOperand())
  }

  private parseChainFrom(first: Expr): Expr {
    if (!this.isComparison(this.peek())) throw new Error('Expected a comparison (<, <=, >, >=, =, !=)')
    let result: Expr | null = null
    let left = first
    while (this.isComparison(this.peek())) {
      const op = (this.next() as Token & { kind: 'op' }).value as ComparisonOp
      const right = this.parseOperand()
      const c = compare(op, left, right)
      result = result ? and(result, c) : c
      left = right
    }
    return result as Expr
  }

  // A piece is "condition: value" or the bare otherwise value.
  private parseConditionOrExpr(): { condition: boolean; expr: Expr } {
    if (this.isWord('not')) return { condition: true, expr: this.parseCondition() }
    const first = this.parseOperand()
    if (!this.isComparison(this.peek())) return { condition: false, expr: first }
    let conj = this.parseChainFrom(first)
    while (this.isWord('and')) {
      this.next()
      conj = and(conj, this.parseNeg())
    }
    let disj = conj
    while (this.isWord('or')) {
      this.next()
      disj = or(disj, this.parseConj())
    }
    return { condition: true, expr: disj }
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }
}

// Parses one full expression from a token slice; throws on leftover tokens or errors.
export function parseExprTokens(tokens: Token[]): Expr {
  const parser = new ExprParser(tokens)
  const expr = parser.parseExpr()
  if (!parser.atEnd()) throw new Error('Unexpected trailing tokens in expression')
  return expr
}

export function parseExprString(input: string): Expr {
  return parseExprTokens(tokenize(input))
}

// A condition — "x < 0", "0 < x <= 1", "y > 0 and x != 2" — as reserved calls
// (math/reserved.ts). Used by "if" clauses (parser/parseStatement.ts).
export function parseConditionString(input: string): Expr {
  const parser = new ExprParser(tokenize(input))
  const expr = parser.parseCondition()
  if (!parser.atEnd()) throw new Error(`Unexpected trailing text in the condition "${input.trim()}"`)
  return expr
}

export { ExprParser }
