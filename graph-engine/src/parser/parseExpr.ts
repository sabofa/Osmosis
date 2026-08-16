import { tokenize, type Token } from './tokenize'
import type { Expr } from './types'

class ExprParser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
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

  private startsPrimary(t: Token | undefined): boolean {
    if (!t) return false
    if (t.kind === 'num' || t.kind === 'ident') return true
    return t.kind === 'op' && t.value === '('
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
      } else if (this.startsPrimary(this.peek())) {
        // implicit multiplication: "2x", "3(x+1)", "2 sin(x)"
        const right = this.parseUnary()
        left = { kind: 'binary', op: '*', left, right }
      } else {
        break
      }
    }
    return left
  }

  // power := primary ('^' unary)?  (right-associative; the exponent side
  // recurses through unary, not straight back to power, so a negative
  // exponent like "2^-1" still parses — see parseUnary's comment on why the
  // base side deliberately does NOT do the same.)
  private parsePower(): Expr {
    const base = this.parsePrimary()
    if (this.isOp(this.peek(), '^')) {
      this.next()
      const exp = this.parseUnary()
      return { kind: 'binary', op: '^', left: base, right: exp }
    }
    return base
  }

  // unary := '-' unary | power
  //
  // Deliberately sits ABOVE power (not below it, the more common naive
  // ordering) so unary minus binds looser than "^": "-2^2" must parse as
  // -(2^2) = -4, matching every standard reference (Desmos, WolframAlpha, TI
  // calculators, Python's "**") — not (-2)^2 = 4. This matters for real
  // specs: "y = -x^2" is a downward-opening parabola; getting this backwards
  // silently flips its sign for every x.
  private parseUnary(): Expr {
    if (this.isOp(this.peek(), '-')) {
      this.next()
      return { kind: 'unary', op: '-', arg: this.parseUnary() }
    }
    return this.parsePower()
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
      if (this.isOp(this.peek(), '(')) {
        this.next()
        const args: Expr[] = []
        if (!this.isOp(this.peek(), ')')) {
          args.push(this.parseExpr())
          while (this.isOp(this.peek(), ',')) {
            this.next()
            args.push(this.parseExpr())
          }
        }
        if (!this.isOp(this.peek(), ')')) throw new Error(`Expected ")" after arguments to "${t.name}"`)
        this.next()
        // Not validated against the builtin set here — a call to a
        // user-defined function (see parser/types.ts's "functionDef"
        // statement, e.g. "k(x) = x^2 + 1") looks identical at this point in
        // parsing, and definitions can appear anywhere in the spec relative
        // to their use. Both builtins and user functions get resolved
        // together at evaluation time instead (evalExpr/compileExpr).
        return { kind: 'call', name: t.name, args }
      }
      return { kind: 'var', name: t.name }
    }

    if (this.isOp(t, '(')) {
      this.next()
      const inner = this.parseExpr()
      if (!this.isOp(this.peek(), ')')) throw new Error('Expected ")"')
      this.next()
      return inner
    }

    throw new Error(`Unexpected token in expression`)
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

export { ExprParser }
