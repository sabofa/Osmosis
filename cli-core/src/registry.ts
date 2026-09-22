import type { ArgKind, CommandContext, CommandSpec, Completion, Suggestion } from './types.js'
import { tokenize, usage } from './parse.js'
import { rank } from './fuzzy.js'

// ----------------------------------------------------------------------------
// The registry: commands keyed by their word path, resolution of a typed line
// to a command plus arguments, completion for the token under the caret, and
// help. Both front ends drive this and nothing else.
// ----------------------------------------------------------------------------

export interface Candidate {
  value: string
  hint?: string
}

// A completer answers "what could this argument be", given what has been
// typed so far. Dynamic kinds hit the node; a host may cache.
export type Completer = (ctx: CommandContext, partial: string) => Promise<Candidate[]>

export class Registry {
  private commands: CommandSpec[] = []
  private completers = new Map<ArgKind, Completer>()

  register(spec: CommandSpec): this {
    this.commands.push(spec)
    return this
  }

  completer(kind: ArgKind, fn: Completer): this {
    this.completers.set(kind, fn)
    return this
  }

  all(): CommandSpec[] {
    return [...this.commands].sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  }

  // The longest command whose path is a prefix of the tokens.
  resolve(tokens: string[]): { spec: CommandSpec; argTokens: string[] } | null {
    let best: CommandSpec | null = null
    for (const spec of this.commands) {
      if (spec.path.length > tokens.length) continue
      if (spec.path.every((w, i) => w === tokens[i].toLowerCase())) {
        if (!best || spec.path.length > best.path.length) best = spec
      }
    }
    return best ? { spec: best, argTokens: tokens.slice(best.path.length) } : null
  }

  // Bind argument tokens to the spec's argument names. A rest argument takes
  // everything left; a missing required argument is an error.
  bind(spec: CommandSpec, argTokens: string[]): { args: Record<string, string>; error?: string } {
    const args: Record<string, string> = {}
    const specs = spec.args ?? []
    let i = 0
    for (const a of specs) {
      if (a.rest) {
        const rest = argTokens.slice(i).join(' ').trim()
        if (rest) args[a.name] = rest
        else if (!a.optional) return { args, error: `${usage(spec.path, specs)} — missing <${a.name}>` }
        i = argTokens.length
        break
      }
      const tok = argTokens[i]
      if (tok === undefined || tok === '') {
        if (!a.optional) return { args, error: `${usage(spec.path, specs)} — missing <${a.name}>` }
        i++
        continue
      }
      args[a.name] = tok
      i++
    }
    return { args }
  }

  async run(ctx: CommandContext, line: string): Promise<void> {
    const { tokens, flags } = tokenize(line)
    const words = tokens.filter((t) => t !== '')
    if (words.length === 0) return
    const hit = this.resolve(words)
    if (!hit) {
      // Bare names: a tag or template with no verb opens it (the last-resort
      // completion the palette offers).
      const guess = await this.guessBare(ctx, words.join(' '))
      if (guess) return this.run(ctx, guess)
      ctx.out.error(`Unknown command: ${words.join(' ')}. Try "help".`)
      return
    }
    const { args, error } = this.bind(hit.spec, hit.argTokens)
    if (error) {
      ctx.out.error(error)
      return
    }
    try {
      await hit.spec.run(ctx, args, flags)
    } catch (err) {
      ctx.out.error(err instanceof Error ? err.message : String(err))
    }
  }

  // "econ" → "open bank economics", "demand quiz" → "open test 'Demand Quiz…'".
  async guessBare(ctx: CommandContext, text: string): Promise<string | null> {
    const tags = (await this.candidates('tag', ctx, text)).filter((c) => c.value.toLowerCase().includes(text.toLowerCase()) || c.hint?.toLowerCase().includes(text.toLowerCase()))
    const templates = (await this.candidates('template', ctx, text)).filter((c) => c.value.toLowerCase().includes(text.toLowerCase()))
    const t = rank(text, tags, (c) => c.hint ?? c.value)[0]
    const p = rank(text, templates, (c) => c.value)[0]
    if (t && (!p || t.score >= p.score)) return `open bank ${quote(t.item.value)}`
    if (p) return `open test ${quote(p.item.value)}`
    return null
  }

  async candidates(kind: ArgKind, ctx: CommandContext, partial: string): Promise<Candidate[]> {
    const fn = this.completers.get(kind)
    if (!fn) return []
    try {
      return await fn(ctx, partial)
    } catch {
      return []
    }
  }

  // Suggestions for the token under the caret (the last token). Command
  // words complete from the registry; arguments from their kind's completer.
  async complete(ctx: CommandContext, line: string): Promise<Completion> {
    const { tokens } = tokenize(line)
    const words = tokens.length ? tokens : ['']
    const tokenIndex = words.length - 1
    const partial = words[tokenIndex]
    const before = words.slice(0, tokenIndex)

    // Still typing the command words?
    const hit = this.resolve(before.filter((t) => t !== ''))
    const wordSuggestions = this.completeWords(before, partial)
    if (!hit || (wordSuggestions.length > 0 && this.stillOnPath(before, hit))) {
      const bare = !hit && before.length === 0 && partial.length >= 2 ? await this.bareSuggestions(ctx, partial) : []
      return { tokenIndex, suggestions: [...wordSuggestions, ...bare].slice(0, 12) }
    }

    const argIndex = before.length - hit.spec.path.length
    const specs = hit.spec.args ?? []
    const restIndex = specs.findIndex((a) => a.rest)
    const spec = restIndex >= 0 && argIndex >= restIndex ? specs[restIndex] : specs[argIndex]
    if (!spec) return { tokenIndex, suggestions: [] }
    // For a rest argument the "partial" is everything typed since it began.
    const restPartial = spec.rest ? [...before.slice(hit.spec.path.length + restIndex), partial].join(' ') : partial
    const list = await this.candidates(spec.kind, ctx, restPartial)
    const ranked = rank(restPartial, list, (c) => `${c.value} ${c.hint ?? ''}`)
    const suggestions: Suggestion[] = ranked.map((r) => ({
      insert: quote(r.item.value),
      label: r.item.value,
      hint: r.item.hint,
      score: r.score,
    }))
    return { tokenIndex: spec.rest ? hit.spec.path.length + restIndex : tokenIndex, suggestions }
  }

  private stillOnPath(before: string[], hit: { spec: CommandSpec }): boolean {
    // A longer command shares this prefix, e.g. "open" typed, "open bank" exists.
    return this.commands.some((c) => c.path.length > before.length && before.every((w, i) => c.path[i] === w.toLowerCase()) && c !== hit.spec)
  }

  private completeWords(before: string[], partial: string): Suggestion[] {
    const depth = before.length
    const seen = new Set<string>()
    const out: Suggestion[] = []
    for (const c of this.commands) {
      if (c.path.length <= depth) continue
      if (!before.every((w, i) => c.path[i] === w.toLowerCase())) continue
      const word = c.path[depth]
      if (seen.has(word)) continue
      seen.add(word)
      out.push({ insert: word, label: word, hint: c.path.length === depth + 1 ? c.describe : undefined, score: 0 })
    }
    return rank(partial, out, (s) => s.label).map((r) => ({ ...r.item, score: r.score }))
  }

  private async bareSuggestions(ctx: CommandContext, partial: string): Promise<Suggestion[]> {
    const tags = await this.candidates('tag', ctx, partial)
    const templates = await this.candidates('template', ctx, partial)
    const t = rank(partial, tags, (c) => c.hint ?? c.value, 4).map((r) => ({
      insert: `open bank ${quote(r.item.value)}`,
      label: `open bank ${r.item.value}`,
      hint: r.item.hint,
      score: r.score - 50,
    }))
    const p = rank(partial, templates, (c) => c.value, 4).map((r) => ({
      insert: `open test ${quote(r.item.value)}`,
      label: `open test ${r.item.value}`,
      hint: r.item.hint,
      score: r.score - 50,
    }))
    return [...t, ...p].sort((a, b) => b.score - a.score)
  }

  helpText(command?: string[]): string {
    if (command && command.length) {
      const hit = this.resolve(command)
      if (!hit) return `No command "${command.join(' ')}".`
      const lines = [usage(hit.spec.path, hit.spec.args), hit.spec.describe]
      if (hit.spec.help) lines.push('', hit.spec.help)
      for (const a of hit.spec.args ?? []) if (a.describe) lines.push(`  ${a.name}: ${a.describe}`)
      return lines.join('\n')
    }
    const rows = this.all().map((c) => `${usage(c.path, c.args).padEnd(34)} ${c.describe}`)
    return ['Commands:', ...rows, '', 'help <command> for details. A bare tag or test name opens it.'].join('\n')
  }
}

export function quote(value: string): string {
  return /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}
