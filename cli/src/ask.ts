import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

// One question on the terminal, one line back; null when stdin closed.
//
// Lines that arrive before anyone asks (piped input, a fast typist) are
// queued rather than dropped: readline emits them as 'line' events, and a
// later ask() takes the oldest first.
export type Ask = (label: string) => Promise<string | null>

export function makeAsk(rl?: readline.Interface): { ask: Ask; close: () => void; rl: readline.Interface } {
  const own = !rl
  const iface = rl ?? readline.createInterface({ input: stdin, output: stdout })
  const queued: string[] = []
  let closed = false
  iface.on('line', (line) => queued.push(line))
  iface.on('close', () => {
    closed = true
  })
  const ask: Ask = async (label) => {
    if (queued.length) {
      const line = queued.shift()!
      stdout.write(`${label}${line}\n`)
      return line
    }
    if (closed) return null
    try {
      return await iface.question(label)
    } catch {
      return null
    }
  }
  return {
    ask,
    rl: iface,
    close: () => {
      if (own) iface.close()
    },
  }
}
