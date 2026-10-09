import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolve, toDocumentTokens, builtinById, DEFAULT_THEME_ID } from 'theme-core'
import type { DocumentTokens } from 'theme-core'
import DocumentViewer from '../DocumentViewer'
import type { DocumentHighlight, DocumentLayer, RenderGraph } from '../types'

// Dev-only harness: the viewer over a gaudy blurred scene, inside a "sheet"
// whose opacity comes from the URL (?opacity=55&mode=dark&case=normal).

const MD = [
  '# Review sheet',
  '',
  'English prose: the quick brown fox jumps over the lazy dog, then reads *emphasis* and **strong** text for a while so wrapping is visible.',
  '',
  'Greek and operators: α β γ ∫ ∑ ≤ ∞. Japanese: 日本語の文章です。 Emoji: 😀 after the smiley.',
  '',
  'Inline math $x^{n+1}$ sits in a line, and prices read $5 and $6 without turning into math.',
  '',
  String.raw`$$\int_0^1 x^2\,dx$$`,
  '',
  'Highlight after the math: this sentence is highlighted.',
  '',
  '- first list item',
  '- second list item with `inline code`',
  '',
  '1. numbered one',
  '2. numbered two',
  '',
  '```python',
  'def f(x):',
  '    return x ** 2  # square',
  '```',
  '',
  '```graph',
  'y = x^2',
  'x in [-3, 3]',
  '```',
  '',
  'Closing paragraph with the author anchor on this phrase and a marker here.',
].join('\n')

const cp = (s: string) => [...s].length
function range(needle: string): { start: number; end: number; quote: string } {
  const i = MD.indexOf(needle)
  if (i < 0) throw new Error('needle missing: ' + needle)
  const start = cp(MD.slice(0, i))
  return { start, end: start + cp(needle), quote: needle }
}

const HIGHLIGHTS: DocumentHighlight[] = [
  { id: 'h1', color: 'yellow', ...range('Emoji: 😀 after the smiley') },
  { id: 'h2', color: 'green', ...range('this sentence is highlighted') },
]

const LAYER: DocumentLayer = {
  anchor: { ...range('author anchor on this phrase'), label: 'Anchor' },
  markers: [
    { id: 'm1', offset: range('Inline math').start },
    { id: 'm2', offset: range('a marker here').start },
  ],
}

const stubGraph: RenderGraph = (spec) => (
  <div style={{ border: '2px solid currentColor', padding: '1.5rem', textAlign: 'center' }}>
    graph stub: {spec.split('\n')[0]}
  </div>
)

function tokensFor(mode: 'light' | 'dark'): DocumentTokens {
  const m = builtinById(DEFAULT_THEME_ID)
  if (!m) throw new Error('default theme missing')
  return toDocumentTokens(resolve(m), m, mode)
}

const SCENE = `
  repeating-linear-gradient(45deg, #ff2d95 0 40px, #ffe600 40px 80px, #00e5ff 80px 120px, #7cff3a 120px 160px)`

export default function ReviewPage(): ReactNode {
  const q = useMemo(() => new URLSearchParams(location.search), [])
  const opacity = Math.min(100, Math.max(0, Number(q.get('opacity') ?? 100))) / 100
  const mode = q.get('mode') === 'dark' ? 'dark' : 'light'
  const kase = q.get('case') ?? 'normal'
  const tokens = useMemo(() => tokensFor(mode), [mode])
  const [hl, setHl] = useState(HIGHLIGHTS)
  useEffect(() => { document.body.style.margin = '0' }, [])
  const sheetBg = `color-mix(in srgb, ${tokens.colors.page} ${opacity * 100}%, transparent)`

  return (
    <div style={{ minHeight: '100vh', background: SCENE, padding: 24, boxSizing: 'border-box' }}>
      <div
        data-testid="sheet"
        style={{
          background: sheetBg,
          backdropFilter: 'blur(14px)',
          color: tokens.colors.text,
          height: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <DocumentViewer
          asset={{ type: 'text', mime: 'text/markdown', content: MD, extractedText: MD }}
          tokens={tokens}
          interaction={kase === 'edit' ? 'edit' : 'annotate'}
          chrome={kase === 'embedded' ? 'embedded' : 'full'}
          gated={kase === 'gated'}
          layers={[LAYER]}
          highlights={hl}
          onHighlightsChange={setHl}
          renderGraph={stubGraph}
        />
      </div>
    </div>
  )
}
