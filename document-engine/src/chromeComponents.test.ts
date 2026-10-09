import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHROME_COMPONENTS } from './chromeComponents'

// Source: Learn spec/osmosis/workspace/frontend/04-design.md section 3.2
// ("Components (data-component)") and live/BRIEF.md "frame contract".
const SHELL_VOCABULARY = [
  'menu', 'menu-item', 'tab', 'tree-row', 'switcher', 'tool-row',
  'history-item', 'week', 'pill', 'card', 'well', 'title-strip', 'toast',
]

describe('CHROME_COMPONENTS', () => {
  it('is within the shell vocabulary', () => {
    for (const c of CHROME_COMPONENTS) expect(SHELL_VOCABULARY).toContain(c)
  })
  it('is non-empty and unique', () => {
    expect(CHROME_COMPONENTS.length).toBeGreaterThan(0)
    expect(new Set(CHROME_COMPONENTS).size).toBe(CHROME_COMPONENTS.length)
  })
  it('every data-component in the chrome sources is listed', () => {
    for (const f of ['./Toolbar.tsx', './DocumentViewer.tsx']) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
      const used = [...src.matchAll(/data-component="([a-z-]+)"/g)].map((m) => m[1])
      for (const u of used) expect(CHROME_COMPONENTS as readonly string[]).toContain(u)
    }
  })
  it('every listed component is used somewhere in the chrome sources', () => {
    const src = ['./Toolbar.tsx', './DocumentViewer.tsx']
      .map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'))
      .join('\n')
    for (const c of CHROME_COMPONENTS) expect(src).toContain(`data-component="${c}"`)
  })
})
