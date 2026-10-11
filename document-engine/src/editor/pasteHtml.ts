// Paste from Word / Google Docs / the web into the markdown editor: the
// clipboard HTML is cleaned (wordClean.ts), converted to markdown with
// Turndown, and inserted as ONE transaction. Plain text stays plain text:
// inside code or math, with Shift held, during IME composition, or when the
// HTML is only the plain text wrapped in a div / span.
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { EditorSelection, Prec, type EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { cleanClipboardHtml } from './wordClean'
import { composingNow } from './compositionGuard'
import { inlineMathInLine, insideBlock, scanLiveBlocks } from './liveScan'

// ---- html -> markdown -----------------------------------------------------

const countOf = (s: string, ch: string) => s.split(ch).length - 1

/** Escape only what would change meaning; the viewer has no general backslash escapes, so less is more. */
export function escapeMarkdown(s: string): string {
  let out = s
  if (countOf(out, '`') >= 2) out = out.replace(/`/g, '\\`')
  if (countOf(out, '$') >= 2) out = out.replace(/\$/g, '\\$')
  out = out
    .replace(/\*(?=\S)|(?<=\S)\*/g, '\\*')
    .replace(/(?<![\p{L}\p{N}])_(?=\S)|(?<=\S)_(?![\p{L}\p{N}])/gu, '\\_')
    .replace(/~~/g, '\\~\\~')
    .replace(/^(\s*)(#{1,6})(?=\s|$)/gm, '$1\\$2')
    .replace(/^(\s*)([-+])(?=\s)/gm, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(?=\s)/gm, '$1$2\\$3')
    .replace(/^(\s*)>/gm, '$1\\>')
    .replace(/^(\s*)(=+|-{2,})\s*$/gm, '$1\\$2')
  return out
}

let service: TurndownService | null = null

function makeService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
    linkStyle: 'inlined',
  })
  td.escape = escapeMarkdown
  td.use(gfm)
  td.addRule('strikethrough', {
    filter: ['del', 's', 'strike'] as unknown as Array<keyof HTMLElementTagNameMap>,
    replacement: (content) => `~~${content}~~`,
  })
  td.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement
      const index = Array.prototype.indexOf.call(parent.childNodes, node)
      return `${index === 0 ? '| ' : ' '}${content.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()} |`
    },
  })
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement
      let prefix = '- '
      if (parent && parent.nodeName === 'OL') {
        const start = parent.getAttribute('start')
        const index = Array.prototype.indexOf.call(parent.children, node)
        prefix = `${start ? Number(start) + index : index + 1}. `
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/g, `\n${' '.repeat(prefix.length)}`)
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '')
    },
  })
  return td
}

/** Collapse 3+ blank lines to 2 everywhere except inside fenced code. */
function collapseBlankLines(md: string): string {
  const out: string[] = []
  let fenced = false
  let blanks = 0
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (!fenced && line.trim() === '') {
      if (++blanks > 1) continue
      out.push('')
    } else { blanks = 0; out.push(line) }
  }
  return out.join('\n')
}

/** Clipboard HTML -> markdown ('' when there is nothing to convert). */
export function htmlToMarkdown(html: string): string {
  const clean = cleanClipboardHtml(html)
  if (!clean.trim()) return ''
  service ??= makeService()
  const md = service.turndown(clean)
  return collapseBlankLines(md.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, (m) => (m.length >= 2 ? m : ''))).trim()
}

// ---- deciding whether to convert ------------------------------------------

const STRUCTURE = /<(?:strong|b|em|i|h[1-6]|ul|ol|li|a|table|blockquote|pre|code|img|del|s|strike)(?=[\s>/])/i
const WORD_MARKERS = /xmlns:o=|urn:schemas-microsoft-com|class\s*=\s*["']?Mso|mso-[a-z-]+\s*:|docs-internal-guid/i

export interface PasteClipboard { html: string; text: string }

/** True when the HTML carries real structure (or Word / Docs markers) worth converting. */
export function shouldConvertPaste(clip: PasteClipboard): boolean {
  const html = clip.html
  if (!html || !html.trim()) return false
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, '')
  if (WORD_MARKERS.test(html)) return STRUCTURE.test(body) || body.replace(/<[^>]*>/g, '').trim().length > 0
  return STRUCTURE.test(body)
}

// ---- CodeMirror -----------------------------------------------------------

const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeInfo', 'CodeMark'])

/** True when any selection range sits in a fenced / indented code block, inline code or math. */
export function selectionInCodeOrMath(state: EditorState): boolean {
  const tree = syntaxTree(state)
  let blocks: ReturnType<typeof scanLiveBlocks> | null = null
  for (const r of state.selection.ranges) {
    for (const at of [r.from, r.to]) {
      for (const side of [-1, 1] as const) {
        for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(at, side); n; n = n.parent) {
          if (CODE_NODES.has(n.name)) return true
        }
      }
    }
    blocks ??= scanLiveBlocks(state.doc.toString())
    if (insideBlock(blocks, r.from, r.to)) return true
    const line = state.doc.lineAt(r.from)
    for (const m of inlineMathInLine(line.text, line.from)) if (r.from > m.from && r.to < m.to) return true
  }
  return false
}

const BLOCK_START = /^(?:#{1,6} |[-*+] |\d+\. |> |\||```)/

/** Insert `md` over every selection range as one 'input.paste' transaction; block markdown gets its own paragraph. */
export function insertPasted(view: EditorView, md: string): void {
  const text = md.replace(/\r\n?/g, '\n')
  const multi = text.includes('\n') || BLOCK_START.test(text)
  view.dispatch(view.state.changeByRange((r) => {
    const doc = view.state.doc
    let insert = text
    if (multi) {
      const before = doc.lineAt(r.from)
      const after = doc.lineAt(r.to)
      if (doc.sliceString(before.from, r.from).trim()) insert = '\n\n' + insert
      if (doc.sliceString(r.to, after.to).trim()) insert += '\n\n'
    }
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length) }
  }), { userEvent: 'input.paste', scrollIntoView: true })
}

function insertPlain(view: EditorView, text: string): void {
  const t = text.replace(/\r\n?/g, '\n')
  view.dispatch(view.state.changeByRange((r) => ({
    changes: { from: r.from, to: r.to, insert: t },
    range: EditorSelection.cursor(r.from + t.length),
  })), { userEvent: 'input.paste', scrollIntoView: true })
}

/** Convert, or null when the paste should stay as it is (nothing to convert, or conversion failed / was empty). */
function tryConvert(clip: PasteClipboard): string | null {
  if (!shouldConvertPaste(clip)) return null
  try {
    const md = htmlToMarkdown(clip.html)
    return md.trim() ? md : null
  } catch {
    return null
  }
}

// Mod-Shift-V pastes plain text: the browser's own paste-as-plain-text sends
// no HTML, and this flag also covers a browser that still sends it.
const PLAIN_WINDOW_MS = 800
const plainUntil = new WeakMap<object, number>()

function onPaste(e: ClipboardEvent, view: EditorView): boolean {
  const cd = e.clipboardData
  if (!cd || view.state.readOnly) return false
  if (view.composing || view.compositionStarted || composingNow(view)) return false
  if ((plainUntil.get(view) ?? 0) > Date.now()) { plainUntil.delete(view); return false }
  const html = cd.getData('text/html')
  const text = cd.getData('text/plain')
  if (cd.files && cd.files.length > 0 && !text) return false
  if (selectionInCodeOrMath(view.state)) return false
  const md = tryConvert({ html, text })
  if (md === null) return false
  e.preventDefault()
  insertPasted(view, md)
  return true
}

/** The paste handler and the Mod-Shift-V (paste as plain text) binding. */
export const pasteHtmlExtension = [
  EditorView.domEventHandlers({ paste: onPaste }),
  Prec.high(keymap.of([{
    key: 'Mod-Shift-v',
    run: (view) => { plainUntil.set(view, Date.now() + PLAIN_WINDOW_MS); return false },
  }])),
]

/** Paste the clipboard as plain text (for a Paste-as-text button). Resolves false when the clipboard cannot be read. */
export async function pastePlainFromClipboard(view: EditorView): Promise<boolean> {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return false
    insertPlain(view, text)
    return true
  } catch {
    return false
  }
}

/** Paste the clipboard, converting HTML to markdown when it is worth it (for the ribbon's Paste button). */
export async function pasteConvertedFromClipboard(view: EditorView): Promise<'converted' | 'plain' | 'none'> {
  let html = '', text = ''
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text()
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text()
    }
  } catch {
    return (await pastePlainFromClipboard(view)) ? 'plain' : 'none'
  }
  const md = selectionInCodeOrMath(view.state) ? null : tryConvert({ html, text })
  if (md !== null) { insertPasted(view, md); return 'converted' }
  if (!text) return 'none'
  insertPlain(view, text)
  return 'plain'
}
