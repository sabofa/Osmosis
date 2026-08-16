import type { Expr } from './types'

export type Bindings = Record<string, number>

const CONSTANTS: Bindings = { pi: Math.PI, e: Math.E }

const DEG_TO_RAD = Math.PI / 180

// A user-defined name from a "k(x) = ..." (function, param set) or
// "a = 5" (constant, param null) statement — see parser/parseStatement.ts.
// Built once per spec (scene/buildScene.ts) and threaded through every
// evaluation so a later statement can reference an earlier definition
// regardless of where in the expression tree it's used.
export interface UserFunction {
  param: string | null
  body: Expr
}
export type FunctionTable = Record<string, UserFunction>

const NO_FUNCTIONS: FunctionTable = {}

function callFunction(name: string, args: number[], angleMode: 'degrees' | 'radians'): number {
  const [a, b] = args
  const angle = angleMode === 'degrees' ? a * DEG_TO_RAD : a
  switch (name) {
    case 'sin':
      return Math.sin(angle)
    case 'cos':
      return Math.cos(angle)
    case 'tan':
      return Math.tan(angle)
    case 'sqrt':
      return Math.sqrt(a)
    case 'abs':
      return Math.abs(a)
    case 'exp':
      return Math.exp(a)
    case 'ln':
      return Math.log(a)
    case 'log':
      return b === undefined ? Math.log10(a) : Math.log(a) / Math.log(b)
    default:
      throw new Error(`Unknown function "${name}"`)
  }
}

export function evalExpr(expr: Expr, bindings: Bindings, angleMode: 'degrees' | 'radians' = 'radians', functions: FunctionTable = NO_FUNCTIONS): number {
  switch (expr.kind) {
    case 'num':
      return expr.value
    case 'var': {
      if (expr.name in bindings) return bindings[expr.name]
      const fn = functions[expr.name]
      if (fn && fn.param === null) return evalExpr(fn.body, {}, angleMode, functions)
      if (expr.name in CONSTANTS) return CONSTANTS[expr.name]
      throw new Error(`Unbound variable "${expr.name}"`)
    }
    case 'unary':
      return -evalExpr(expr.arg, bindings, angleMode, functions)
    case 'binary': {
      const left = evalExpr(expr.left, bindings, angleMode, functions)
      const right = evalExpr(expr.right, bindings, angleMode, functions)
      switch (expr.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          return left / right
        case '^':
          return Math.pow(left, right)
      }
      break
    }
    case 'call': {
      const fn = functions[expr.name]
      if (fn && fn.param !== null) {
        const argValue = evalExpr(expr.args[0], bindings, angleMode, functions)
        return evalExpr(fn.body, { [fn.param]: argValue }, angleMode, functions)
      }
      return callFunction(
        expr.name,
        expr.args.map((a) => evalExpr(a, bindings, angleMode, functions)),
        angleMode
      )
    }
  }
}

export type CompiledExpr = (bindings: Bindings) => number

function compileCall(name: string, args: CompiledExpr[], angleMode: 'degrees' | 'radians'): CompiledExpr {
  const a = args[0]
  const b = args[1]
  switch (name) {
    case 'sin':
      return angleMode === 'degrees' ? (bindings) => Math.sin(a(bindings) * DEG_TO_RAD) : (bindings) => Math.sin(a(bindings))
    case 'cos':
      return angleMode === 'degrees' ? (bindings) => Math.cos(a(bindings) * DEG_TO_RAD) : (bindings) => Math.cos(a(bindings))
    case 'tan':
      return angleMode === 'degrees' ? (bindings) => Math.tan(a(bindings) * DEG_TO_RAD) : (bindings) => Math.tan(a(bindings))
    case 'sqrt':
      return (bindings) => Math.sqrt(a(bindings))
    case 'abs':
      return (bindings) => Math.abs(a(bindings))
    case 'exp':
      return (bindings) => Math.exp(a(bindings))
    case 'ln':
      return (bindings) => Math.log(a(bindings))
    case 'log':
      return b ? (bindings) => Math.log(a(bindings)) / Math.log(b(bindings)) : (bindings) => Math.log10(a(bindings))
    default:
      throw new Error(`Unknown function "${name}"`)
  }
}

// Compiles an Expr into a closure tree once, instead of re-walking the AST
// (re-dispatching through `switch (expr.kind)` from the root, every time) on
// every single evaluation. Worth it specifically for the hot sampling loops
// in scene/buildScene.ts — a region or implicit curve alone evaluates its
// expression ~40,000 times per rebuild. `angleMode`/`functions` are baked in
// at compile time (both fixed for the whole rebuild, never vary per-sample),
// so the returned closure doesn't re-check either on every call the way
// evalExpr does. One-off evaluations (a point's coordinates, a tangent's
// "at x =", ...) aren't worth compiling — evalExpr stays the right tool there.
export function compileExpr(expr: Expr, angleMode: 'degrees' | 'radians' = 'radians', functions: FunctionTable = NO_FUNCTIONS): CompiledExpr {
  switch (expr.kind) {
    case 'num': {
      const value = expr.value
      return () => value
    }
    case 'var': {
      const name = expr.name
      const fn = functions[name]
      if (fn && fn.param === null) {
        const value = compileExpr(fn.body, angleMode, functions)({})
        return () => value
      }
      if (name in CONSTANTS) {
        const value = CONSTANTS[name]
        return () => value
      }
      return (bindings) => {
        if (name in bindings) return bindings[name]
        throw new Error(`Unbound variable "${name}"`)
      }
    }
    case 'unary': {
      const arg = compileExpr(expr.arg, angleMode, functions)
      return (bindings) => -arg(bindings)
    }
    case 'binary': {
      const left = compileExpr(expr.left, angleMode, functions)
      const right = compileExpr(expr.right, angleMode, functions)
      switch (expr.op) {
        case '+':
          return (bindings) => left(bindings) + right(bindings)
        case '-':
          return (bindings) => left(bindings) - right(bindings)
        case '*':
          return (bindings) => left(bindings) * right(bindings)
        case '/':
          return (bindings) => left(bindings) / right(bindings)
        case '^':
          return (bindings) => Math.pow(left(bindings), right(bindings))
      }
      break
    }
    case 'call': {
      const fn = functions[expr.name]
      if (fn && fn.param !== null) {
        const argClosure = compileExpr(expr.args[0], angleMode, functions)
        const bodyClosure = compileExpr(fn.body, angleMode, functions)
        const param = fn.param
        return (bindings) => bodyClosure({ [param]: argClosure(bindings) })
      }
      return compileCall(
        expr.name,
        expr.args.map((a) => compileExpr(a, angleMode, functions)),
        angleMode
      )
    }
  }
  throw new Error('Unreachable expression kind')
}

// Which free variables (other than the given knowns) an expression references —
// used to sanity-check statements, e.g. an explicit "y = ..." body shouldn't reference y.
export function freeVariables(expr: Expr, exclude: Set<string> = new Set()): Set<string> {
  const found = new Set<string>()
  function walk(e: Expr) {
    if (e.kind === 'var') {
      if (!(e.name in CONSTANTS) && !exclude.has(e.name)) found.add(e.name)
    } else if (e.kind === 'unary') {
      walk(e.arg)
    } else if (e.kind === 'binary') {
      walk(e.left)
      walk(e.right)
    } else if (e.kind === 'call') {
      e.args.forEach(walk)
    }
  }
  walk(expr)
  return found
}
