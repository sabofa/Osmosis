// Pure string -> string pre-clean of clipboard HTML before it goes to the
// markdown converter. It understands Microsoft Word's clipboard HTML (CF_HTML
// wrapper, conditional comments, MsoListParagraph lists, Mso heading classes,
// styled spans), Google Docs' quirks (the `font-weight:normal` bold wrapper,
// weight-700 spans) and generic web pages (chrome such as nav / footer /
// scripts is dropped). No DOM is used, so it runs anywhere.

const MAX_INLINE_DATA_URL = 2048

// Elements removed together with everything inside them.
const DROP_ELEMENTS = [
  'style', 'script', 'xml', 'head', 'title', 'noscript', 'nav', 'aside', 'footer', 'form',
  'button', 'iframe', 'svg', 'select', 'textarea', 'template', 'object', 'canvas', 'video', 'audio', 'caption',
]

/** Index just past the `</tag>` that closes the element whose content starts at `from` (depth aware); -1 when unclosed. */
function findClose(html: string, tag: string, from: number): number {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'gi')
  re.lastIndex = from
  let depth = 1
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) { if (--depth === 0) return m.index + m[0].length }
    else if (!m[0].endsWith('/>')) depth++
  }
  return -1
}

/** Remove every `<tag ...>...</tag>` (nesting respected); an unclosed opener is removed alone. */
function dropElements(html: string, tag: string): string {
  const open = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, 'i')
  let out = html
  for (let guard = 0; guard < 5000; guard++) {
    const m = open.exec(out)
    if (!m) break
    const end = m[0].endsWith('/>') ? m.index + m[0].length : findClose(out, tag, m.index + m[0].length)
    out = out.slice(0, m.index) + (end < 0 ? out.slice(m.index + m[0].length) : out.slice(end))
  }
  return out
}

/** Replace the first matching opener `re` and its closing tag by nothing, keeping the content. */
function unwrapAll(html: string, tag: string, openerTest: RegExp): string {
  const open = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, 'gi')
  let out = html
  let from = 0
  for (let guard = 0; guard < 5000; guard++) {
    open.lastIndex = from
    const m = open.exec(out)
    if (!m) break
    if (!openerTest.test(m[0])) { from = m.index + m[0].length; continue }
    const contentStart = m.index + m[0].length
    const end = findClose(out, tag, contentStart)
    if (end < 0) { out = out.slice(0, m.index) + out.slice(contentStart); from = m.index; continue }
    const closeStart = out.lastIndexOf('</', end - 1)
    out = out.slice(0, m.index) + out.slice(contentStart, closeStart) + out.slice(end)
    from = m.index
  }
  return out
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;| /gi, ' ').trim()

// ---- fragment, comments, namespaces -------------------------------------

function takeFragment(html: string): string {
  const s = html.indexOf('<!--StartFragment-->')
  if (s >= 0) {
    const from = s + '<!--StartFragment-->'.length
    const e = html.indexOf('<!--EndFragment-->', from)
    return e >= 0 ? html.slice(from, e) : html.slice(from)
  }
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html)
  return body ? body[1] : html
}

function stripNoise(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[(?:if|endif)[^>]*\]>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<(?:meta|link|base)\b[^>]*>/gi, '')
  for (const tag of DROP_ELEMENTS) out = dropElements(out, tag)
  // Office namespaces (<o:p>, <w:*>, <v:*>): the tags go, any text stays.
  out = dropElements(out, 'v:shapetype')
  out = out.replace(/<\/?(?:o|w|v|m|st1|x|u1):[a-z0-9-]+\b[^>]*>/gi, '')
  return out
}

// ---- Word paragraphs: lists and headings --------------------------------

function markerSpan(inner: string): { marker: string; rest: string } | null {
  const open = /<span\b[^>]*mso-list\s*:\s*Ignore[^>]*>/i.exec(inner)
  if (!open) return null
  const start = open.index + open[0].length
  const end = findClose(inner, 'span', start)
  if (end < 0) return null
  const closeStart = inner.lastIndexOf('</', end - 1)
  return { marker: textOf(inner.slice(start, closeStart)), rest: inner.slice(0, open.index) + inner.slice(end) }
}

const ORDERED_MARKER = /^(?:\d+|[a-z]|[ivxlcdm]+)[.)]$/i

function convertParagraphs(html: string): string {
  const withItems = html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (whole, attrs: string, inner: string) => {
    const isList = /MsoListParagraph/i.test(attrs) || /mso-list\s*:\s*l\d+/i.test(attrs)
    if (isList) {
      const level = Math.max(1, Number(/level(\d+)/i.exec(attrs)?.[1] ?? 1))
      const mk = markerSpan(inner)
      const marker = mk?.marker ?? ''
      const ordered = ORDERED_MARKER.test(marker)
      const start = ordered && /^\d+/.test(marker) ? Number(/^\d+/.exec(marker)![0]) : 0
      return `<wordli level="${level}" ordered="${ordered ? 1 : 0}" start="${start}">${mk ? mk.rest : inner}</wordli>`
    }
    const cls = /class\s*=\s*["']?Mso(Title|Subtitle|Heading\s?([1-6]))\b/i.exec(attrs)
    if (cls) {
      const n = cls[2] ? Number(cls[2]) : cls[1].toLowerCase() === 'title' ? 1 : 2
      return `<h${n}>${inner}</h${n}>`
    }
    return whole
  })
  return withItems.replace(/(?:<wordli\b[^>]*>[\s\S]*?<\/wordli>\s*)+/gi, (run) => buildLists(run))
}

function buildLists(run: string): string {
  const items: { level: number; ordered: boolean; start: number; html: string }[] = []
  const re = /<wordli level="(\d+)" ordered="(\d)" start="(\d+)">([\s\S]*?)<\/wordli>/gi
  for (let m = re.exec(run); m; m = re.exec(run)) {
    items.push({ level: Number(m[1]), ordered: m[2] === '1', start: Number(m[3]), html: m[4].trim() })
  }
  let out = ''
  const stack: string[] = []
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul'
    const level = Math.max(1, Math.min(it.level, stack.length + 1))
    while (stack.length > level) out += `</li></${stack.pop()}>`
    if (stack.length === level) {
      if (stack[stack.length - 1] === tag) out += '</li>'
      else { out += `</li></${stack.pop()}>`; out += openList(tag, it.start); stack.push(tag) }
    } else {
      out += openList(tag, it.start)
      stack.push(tag)
    }
    out += `<li>${it.html}`
  }
  while (stack.length) out += `</li></${stack.pop()}>`
  return out
}

const openList = (tag: string, start: number) => (tag === 'ol' && start > 1 ? `<ol start="${start}">` : `<${tag}>`)

// ---- spans -> semantic tags ---------------------------------------------

interface SpanFrame { close: string; b: boolean; i: boolean; s: boolean }

function mapSpans(html: string): string {
  let bold = 0, ital = 0, strike = 0
  const stack: SpanFrame[] = []
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?=[\s>/])([^>]*)>|[^<]+|</g
  let out = ''
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[2] === undefined) { out += m[0]; continue }
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    if (name === 'font') continue
    if (name === 'b' || name === 'strong') { bold = Math.max(0, bold + (closing ? -1 : 1)); out += m[0]; continue }
    if (name === 'i' || name === 'em') { ital = Math.max(0, ital + (closing ? -1 : 1)); out += m[0]; continue }
    if (name === 's' || name === 'del' || name === 'strike') { strike = Math.max(0, strike + (closing ? -1 : 1)); out += m[0]; continue }
    if (name !== 'span') { out += m[0]; continue }
    if (closing) {
      const f = stack.pop()
      if (f) { out += f.close; if (f.b) bold--; if (f.i) ital--; if (f.s) strike-- }
      continue
    }
    if (m[0].endsWith('/>')) continue
    const style = attr(m[0], 'style') ?? ''
    const wantBold = /font-weight\s*:\s*(?:bold|bolder|[6-9]00)\b/i.test(style) && bold === 0
    const wantItal = /font-style\s*:\s*italic/i.test(style) && ital === 0
    const wantStrike = /text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style) && strike === 0
    let open = '', close = ''
    if (wantBold) { open += '<strong>'; close = '</strong>' + close; bold++ }
    if (wantItal) { open += '<em>'; close = '</em>' + close; ital++ }
    if (wantStrike) { open += '<s>'; close = '</s>' + close; strike++ }
    stack.push({ close, b: wantBold, i: wantItal, s: wantStrike })
    out += open
  }
  return out
}

// ---- tables ---------------------------------------------------------------

function cleanTable(table: string): string {
  let out = table.replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_w, tag: string, attrs: string, inner: string) => {
    let a = attrs
    if (attr(`<x${a}>`, 'align') === null) {
      const al = /text-align\s*:\s*(left|right|center)/i.exec(a) ?? /text-align\s*:\s*(left|right|center)/i.exec(inner)
      if (al) a += ` align="${al[1].toLowerCase()}"`
    }
    const flat = inner.replace(/<\/?(?:p|div)\b[^>]*>/gi, ' ').replace(/(?:\s*<br\s*\/?>\s*)+/gi, ' ').replace(/\s+/g, ' ').trim()
    return `<${tag}${a}>${flat}</${tag}>`
  })
  const firstRow = /<tr\b[^>]*>[\s\S]*?<\/tr>/i.exec(out)
  if (firstRow && !/<th[\s>]/i.test(firstRow[0])) {
    const header = firstRow[0].replace(/<td(?=[\s>])/gi, '<th').replace(/<\/td>/gi, '</th>')
    out = out.slice(0, firstRow.index) + header + out.slice(firstRow.index + firstRow[0].length)
  }
  return out
}

function convertTables(html: string): string {
  let out = ''
  let pos = 0
  const open = /<table(?=[\s>/])[^>]*>/gi
  for (let guard = 0; guard < 2000; guard++) {
    open.lastIndex = pos
    const m = open.exec(html)
    if (!m) break
    const end = findClose(html, 'table', m.index + m[0].length)
    if (end < 0) break
    out += html.slice(pos, m.index) + cleanTable(html.slice(m.index, end))
    pos = end
  }
  return out + html.slice(pos)
}

// ---- images ---------------------------------------------------------------

function convertImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attr(tag, 'alt') ?? ''
    let src = attr(tag, 'src') ?? ''
    const lazy = attr(tag, 'data-src') ?? attr(tag, 'data-original') ?? ''
    if (/^https?:\/\//i.test(lazy) && (!src || src.startsWith('data:'))) src = lazy
    const dead = !src || /^(?:file|cid|blob|webkit-fake-url):/i.test(src) || (/^data:/i.test(src) && src.length > MAX_INLINE_DATA_URL)
    if (dead) return alt.trim()
    return `<img src="${src.replace(/"/g, '&quot;')}"${alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : ''}>`
  })
}

// ---- entry ----------------------------------------------------------------

/**
 * Clean clipboard HTML (Word, Google Docs or a web page) down to plain
 * semantic markup: only the fragment, no Office noise, real lists / headings /
 * emphasis, tables with a header row, and no dead images.
 */
export function cleanClipboardHtml(input: string): string {
  let html = takeFragment(input)
  html = stripNoise(html)
  // Google Docs wraps everything in <b style="font-weight:normal" id="docs-internal-guid-...">.
  html = unwrapAll(html, 'b', /font-weight\s*:\s*normal|docs-internal-guid/i)
  html = unwrapAll(html, 'strong', /font-weight\s*:\s*normal/i)
  html = convertParagraphs(html)
  html = html.replace(/&nbsp;|&#160;|&#xa0;|[ ​]/gi, ' ')
  html = mapSpans(html)
  html = convertTables(html)
  html = convertImages(html)
  // <pre> without <code> still becomes a fenced block downstream.
  html = html.replace(/<pre\b([^>]*)>(?!\s*<code)([\s\S]*?)<\/pre>/gi, '<pre$1><code>$2</code></pre>')
  html = html.replace(/(<input\b[^>]*type\s*=\s*["']?checkbox[^>]*>)\s+/gi, '$1')
  html = html.replace(/<p\b[^>]*>(?:\s|<br\s*\/?>|<\/?span\b[^>]*>)*<\/p>/gi, '')
  // A lone paragraph inside a list item (Google Docs) is just the item's text.
  html = html.replace(/<li\b([^>]*)>\s*<p\b[^>]*>((?:(?!<\/?p\b)[\s\S])*?)<\/p>\s*<\/li>/gi, '<li$1>$2</li>')
  return html.trim()
}

export const cleanWordHtml = cleanClipboardHtml
