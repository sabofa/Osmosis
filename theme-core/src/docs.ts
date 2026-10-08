import { TOKENS } from './registry/index.js'
import type { Group } from './registry/types.js'
import { builtinById } from './builtins/index.js'
import { resolve } from './resolve.js'
import { ALIASES } from './emit.js'

const GROUPS: readonly Group[] = [
  'colour', 'type', 'shape', 'space', 'elevation', 'motion', 'surface', 'graph', 'document', 'component',
]

const esc = (s: string): string => s.replace(/\|/g, '\|').replace(/\r?\n/g, ' ')
const code = (s: string | undefined): string => (s === undefined || s === '' ? '—' : '`' + esc(s) + '`')

/** Markdown reference for every theme token, generated from the registry. */
export function renderTokensDoc(): string {
  const osmosis = builtinById('builtin:osmosis')
  const r = osmosis ? resolve(osmosis) : undefined
  const out: string[] = []
  out.push('# Osmosis theme tokens', '')
  out.push(
    '> Generated file — do not edit. Regenerate with `npm run docs --workspace=theme-core`.',
    '',
    'Every token is a CSS custom property `--<name>`. There are two tiers: semantic tokens derive from the theme seeds and dials, ' +
    'and component tokens derive from semantic tokens. Any token can be overridden per mode in a theme manifest `overrides`. ' +
    'Defaults below are the resolved values of the built-in Osmosis theme.',
    '',
  )
  for (const g of GROUPS) {
    out.push(`## ${g}`, '')
    out.push('| token | tier | type | modes | meaning | light default | dark default |')
    out.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const t of TOKENS.filter((x) => x.group === g)) {
      let meaning = esc(t.meaning)
      if (t.allowed) meaning += ` Allowed: ${t.allowed.map(esc).join(' | ')}`
      out.push(
        `| \`${t.name}\` | ${t.tier} | ${t.type} | ${t.modeDependent ? 'both' : 'same'} | ${meaning} | ${code(r?.light[t.name])} | ${code(r?.dark[t.name])} |`,
      )
    }
    out.push('')
  }
  out.push('## Old names (aliases)', '')
  out.push('| old | new |', '| --- | --- |')
  for (const [old, next] of Object.entries(ALIASES)) out.push(`| \`${esc(old)}\` | \`--${esc(next)}\` |`)
  out.push('')
  return out.join('\n')
}
