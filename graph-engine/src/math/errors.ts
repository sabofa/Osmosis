// The kernel's compile-time refusal. It lives in its own module, and compile.ts
// re-exports it, so that diff.ts can subclass it at module load: compile.ts
// reaches diff.ts through prime.ts (f'(x)), and a module cycle through
// compile.ts itself would evaluate `class DerivativeRefusal extends
// CompileError` before the class existed.

// `names` carries the offending name(s): the unknown variable, the function
// called with the wrong arity, or both ends of a cycle.
export class CompileError extends Error {
  readonly names: readonly string[]

  constructor(message: string, names: readonly string[]) {
    super(message)
    this.name = 'CompileError'
    this.names = names
  }
}
