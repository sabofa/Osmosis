import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTokensDoc } from '../src/docs.js'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '..', '..', 'docs', 'theming', 'TOKENS.md')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, renderTokensDoc(), 'utf8')
console.log(`wrote ${target}`)
