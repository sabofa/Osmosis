import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { buildRegistry, tokenize, type CommandContext } from 'cli-core'
import { makeApi, makeOut, makeUi } from './terminal.js'
import { makeAsk } from './ask.js'

// ----------------------------------------------------------------------------
// `osmosis <command…>` runs one command against a node and exits;
// `osmosis` alone opens a prompt with Tab completion. The node is
// --url <base> or OSMOSIS_URL, default http://localhost:8081. Same commands,
// same completion as the app's / bar — this is just the other front end.
// ----------------------------------------------------------------------------

const DEFAULT_URL = 'http://localhost:8081'

export async function main(argv: string[]): Promise<void> {
  let url = process.env.OSMOSIS_URL ?? DEFAULT_URL
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) url = argv[++i]
    else if (argv[i].startsWith('--url=')) url = argv[i].slice(6)
    else rest.push(argv[i])
  }

  const registry = buildRegistry()
  const api = makeApi(url)
  const write = (s: string) => console.log(s)

  if (rest.length > 0) {
    const { ask, close } = makeAsk()
    const ctx: CommandContext = { api, out: makeOut(write), ui: makeUi(api, ask, url, write) }
    try {
      await registry.run(ctx, rest.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' '))
    } finally {
      close()
    }
    return
  }

  // The prompt. readline's completer is synchronous, so completion runs
  // ahead on every keystroke and the completer answers from that cache.
  let cached: { line: string; items: string[] } = { line: '', items: [] }
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    completer: (line: string): [string[], string] => {
      if (cached.line === line) return [cached.items, lastToken(line)]
      return [[], lastToken(line)]
    },
    historySize: 200,
  })
  const { ask } = makeAsk(rl)
  const ctx: CommandContext = { api, out: makeOut(write), ui: makeUi(api, ask, url, write) }

  let seq = 0
  const refresh = async (line: string) => {
    const mine = ++seq
    try {
      const c = await registry.complete(ctx, line)
      if (mine !== seq) return
      cached = { line, items: c.suggestions.map((s) => s.insert) }
    } catch {
      /* completion is best effort */
    }
  }
  stdin.on('keypress', () => {
    // After readline has applied the key, look at the new line.
    setImmediate(() => void refresh(rl.line))
  })

  write(`osmosis · ${url} · Tab completes · help lists commands · exit leaves`)
  try {
    const status = await api.get<{ node?: { label?: string }; online?: boolean }>('/api/status')
    write(`connected to ${status.node?.label ?? 'node'}${status.online === false ? ' (offline from the server)' : ''}`)
  } catch (err) {
    write(`! ${(err as Error).message}`)
  }

  for (;;) {
    const line = await ask('osmosis> ')
    if (line === null) break
    const t = line.trim()
    if (!t) continue
    if (t === 'exit' || t === 'quit') break
    await registry.run(ctx, t)
  }
  rl.close()
}

function lastToken(line: string): string {
  const { tokens } = tokenize(line)
  return tokens[tokens.length - 1] ?? ''
}
