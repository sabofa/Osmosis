import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { editorExtensions, cursorInListItem, listIndentKeymap, lineOpsKeymap } from './extensions'

const mk = (doc: string, pos = doc.length, readOnly = false) =>
  EditorState.create({ doc, selection: { anchor: pos }, extensions: editorExtensions({ readOnly }) })

describe('editorExtensions', () => {
  it('builds an EditorState without throwing', () => {
    const s = mk('# hi\n\n- a\n')
    expect(s.doc.toString()).toBe('# hi\n\n- a\n')
    expect(s.facet(EditorState.allowMultipleSelections)).toBe(true)
    expect(s.readOnly).toBe(false)
  })
  it('registers GFM markdown parsing', () => {
    const s = mk('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~x~~')
    const tree = ensureSyntaxTree(s, s.doc.length, 5000)!
    const names: string[] = []
    tree.iterate({ enter: (n) => { names.push(n.name) } })
    expect(names).toContain('Table')
    expect(names).toContain('Strikethrough')
  })
  it('honours readOnly', () => {
    expect(mk('x', 0, true).readOnly).toBe(true)
  })
  it('Enter continuation continues a list', () => {
    const s = mk('- item')
    ensureSyntaxTree(s, s.doc.length, 5000)
    let next: EditorState | null = null
    const ok = insertNewlineContinueMarkup({ state: s, dispatch: (tr: { state: EditorState }) => { next = tr.state } } as never)
    expect(ok).toBe(true)
    expect(next!.doc.toString()).toBe('- item\n- ')
  })
  it('Tab is list-only', () => {
    const para = mk('plain text')
    ensureSyntaxTree(para, para.doc.length, 5000)
    expect(cursorInListItem(para)).toBe(false)
    const list = mk('- a\n- b')
    ensureSyntaxTree(list, list.doc.length, 5000)
    expect(cursorInListItem(list)).toBe(true)
    expect(listIndentKeymap.map((k) => k.key)).toEqual(['Tab', 'Shift-Tab'])
    let dispatched = 0
    const fake = (s: EditorState) => ({ state: s, dispatch: () => { dispatched++ } }) as never
    expect(listIndentKeymap[0].run(fake(para))).toBe(false)
    expect(listIndentKeymap[0].run(fake(list))).toBe(true)
    expect(dispatched).toBe(1)
  })
  it('registers the line-op keys', () => {
    expect(lineOpsKeymap.map((k) => k.key)).toEqual([
      'Alt-ArrowUp', 'Alt-ArrowDown', 'Shift-Alt-ArrowUp', 'Shift-Alt-ArrowDown', 'Mod-Shift-k',
    ])
  })
})

describe('editor files colour/font literal guard', () => {
  for (const f of ['./extensions.ts', './MarkdownEditor.tsx', './editorSync.ts']) {
    it(`${f} has no colour or font literals`, () => {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
      expect(src).not.toMatch(/['"`](?:red|blue|green|black|white|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|silver|gold|navy|teal)['"`]/i)
      expect(src).not.toMatch(/(?:color|backgroundColor|borderLeftColor)\s*:\s*['"](?!var\(|transparent|inherit)/)
      expect(src).not.toMatch(/fontFamily\s*:\s*['"](?!var\(|inherit)/)
      // var(--x, 0.25em) hides a size the host's sheet never defined
      expect(src).not.toMatch(/var\(\s*--[\w-]+\s*,\s*[-+]?(?:\d+\.?\d*|\.\d+)[a-z%]*\s*\)/i)
    })
  }
  it('the numeric var() fallback pattern catches what it should', () => {
    const re = /var\(\s*--[\w-]+\s*,\s*[-+]?(?:\d+\.?\d*|\.\d+)[a-z%]*\s*\)/i
    for (const bad of ['var(--x, 0.25em)', 'var(--x,2px)', 'var(--x, .5rem)', 'var(--x, 100%)', 'var(--x, 0)']) expect(re.test(bad)).toBe(true)
    for (const ok of ['var(--de-radius-sm)', 'var(--x, var(--y))']) expect(re.test(ok)).toBe(false)
  })
})

describe('readOnly compartment', () => {
  it('reconfigures a state without rebuilding it', async () => {
    const { Compartment } = await import('@codemirror/state')
    const { readOnlyExtension } = await import('./extensions')
    const comp = new Compartment()
    let s = EditorState.create({ doc: 'x', extensions: editorExtensions({ readOnlyCompartment: comp }) })
    expect(s.readOnly).toBe(false)
    s = s.update({ effects: comp.reconfigure(readOnlyExtension(true)) }).state
    expect(s.readOnly).toBe(true)
    s = s.update({ effects: comp.reconfigure(readOnlyExtension(false)) }).state
    expect(s.readOnly).toBe(false)
    expect(s.doc.toString()).toBe('x')
  })
})
