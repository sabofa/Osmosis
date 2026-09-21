import katex from 'katex'
// Side-effect import: mhchem registers \ce{…} and \pu{…} as katex macros. It
// must be imported exactly once, before any render call — the question bank is
// half chemistry, so this is not optional.
import 'katex/contrib/mhchem'

export type SegmentKind = 'text' | 'inline' | 'display'

export interface Segment {
  kind: SegmentKind
  value: string
}

// The grammar is deliberately small and predictable rather than clever:
//   \$          → a literal dollar sign in the surrounding text
//   \[ … \]     → display math
//   $$ … $$     → display math
//   $ … $       → inline math, but only when the closing $ is in the same
//                 paragraph (no blank line in between)
// Anything else — including a lone, unmatched $ — is literal text. That last
// rule is what keeps prices ("costs $5 total") from swallowing half a prompt;
// we deliberately do not try to guess at currency beyond it.
export function segment(text: string): Segment[] {
  const segments: Segment[] = []
  let buffer = ''

  function flushText() {
    if (buffer) {
      segments.push({ kind: 'text', value: buffer })
      buffer = ''
    }
  }

  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)

    if (rest.startsWith('\\$')) {
      buffer += '$'
      i += 2
      continue
    }

    if (rest.startsWith('\\[')) {
      const end = text.indexOf('\\]', i + 2)
      if (end !== -1) {
        flushText()
        segments.push({ kind: 'display', value: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }

    if (rest.startsWith('$$')) {
      const end = text.indexOf('$$', i + 2)
      if (end !== -1) {
        flushText()
        segments.push({ kind: 'display', value: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
      // Unmatched `$$` is literal, same as an unmatched `$`. Consuming both
      // characters here is what stops the single-`$` branch below from pairing
      // them with each other and emitting an empty inline segment.
      buffer += '$$'
      i += 2
      continue
    }

    if (rest.startsWith('$') && !isSpace(text[i + 1])) {
      const end = findClosingDollar(text, i + 1)
      if (end !== -1) {
        flushText()
        segments.push({ kind: 'inline', value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    buffer += text[i]
    i += 1
  }

  flushText()
  return segments
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch)
}

// Index of the `$` that closes an inline run opened at `from - 1`, or -1 when
// there isn't one in the same paragraph. A `\$` doesn't close a run, and a
// blank line ends the search: prose with two unrelated prices on separate
// paragraphs must not be read as one enormous formula.
//
// The two extra conditions on a closing `$` are pandoc's tex_math_dollars rule
// (its opening half — no whitespace after the opening `$` — is enforced at the
// call site): a closer must be preceded by non-whitespace and must not be
// followed by a digit. That second clause is what finally settles prices — in
// "P=$50) to B (Q=15, P=$30)" the only candidate closer is followed by `3`, so
// both dollars stay literal instead of turning most of the sentence into a
// formula.
function findClosingDollar(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i += 1
      continue
    }
    if (text[i] === '$') {
      if (isSpace(text[i - 1])) continue
      if (/[0-9]/.test(text[i + 1] ?? '')) continue
      return i
    }
    if (text[i] === '\n' && text[i + 1] === '\n') return -1
  }
  return -1
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

// Text segments are escaped here; math segments come back as katex's own
// (trusted, trust:false) markup. This is the only reason RichText.tsx may use
// dangerouslySetInnerHTML — nothing else in the app should.
export function render(text: string): string {
  return segment(text)
    .map((seg) => {
      if (seg.kind === 'text') {
        return escapeHtml(seg.value).replace(/\n/g, '<br>')
      }
      return katex.renderToString(seg.value, {
        throwOnError: false,
        displayMode: seg.kind === 'display',
        trust: false,
      })
    })
    .join('')
}
