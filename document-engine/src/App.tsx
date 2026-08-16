import { useEffect, useRef, useState } from 'react'
import DocumentViewer from './DocumentViewer'
import { extractPdfText } from './core/extractPdfText'
import { findTokenSpan } from './core/findTokenSpan'
import type { DocumentAnchor, DocumentHighlight, DocumentMarker } from './types'
import './App.css'

type Kind = 'text' | 'file'

interface Preset {
  label: string
  content: string
  markers: DocumentMarker[]
  anchor: DocumentAnchor | null
}

// Mirrors the "ACT-English passage with inline markers" use case this whole
// engine was built for — each bracketed letter is a question's
// document_marker_offset, and the range around (C) is a document_anchor
// (the excerpt highlight an author sets independently of any marker).
const PRESETS: Preset[] = [
  {
    label: 'ACT-style passage',
    content:
      'The old bridge, (A) which had stood for nearly a century, groaned under the ' +
      'weight of the delivery truck. Engineers had (B) warned the city council twice ' +
      'before, but funding for repairs kept getting pushed to next year. ' +
      '(C) Local residents, frustrated by the delay, organized a petition demanding ' +
      'immediate inspection. Now, standing at the edge of the span, the lead inspector ' +
      'wondered whether this crossing would survive the winter.',
    markers: [],
    anchor: null,
  },
  {
    label: 'Plain passage, no markers',
    content:
      'Osmosis is the spontaneous movement of solvent molecules through a ' +
      'semi-permeable membrane from a region of low solute concentration to a region ' +
      'of high solute concentration, until the concentrations on both sides are equal.',
    markers: [],
    anchor: null,
  },
]

// Fills in the marker offsets/anchor for the first preset from the literal
// text above, so the demo starts pre-populated with something clickable
// instead of an empty control panel.
function withActMarkers(preset: Preset): Preset {
  const c = preset.content
  const aOffset = c.indexOf('(A)') + 1
  const bOffset = c.indexOf('(B)') + 1
  const cOffset = c.indexOf('(C)')
  if (aOffset <= 0 || bOffset <= 0 || cOffset < 0) return preset
  const anchorEnd = c.indexOf('.', cOffset) + 1
  return {
    ...preset,
    markers: [
      { id: 'question-a', offset: aOffset },
      { id: 'question-b', offset: bOffset },
    ],
    anchor: { start: cOffset, end: anchorEnd > cOffset ? anchorEnd : cOffset + 40, label: 'Sentence (C)' },
  }
}

PRESETS[0] = withActMarkers(PRESETS[0])

let markerCounter = 0

export default function App() {
  const [kind, setKind] = useState<Kind>('text')
  const [content, setContent] = useState(PRESETS[0].content)
  const [extractedText, setExtractedText] = useState(PRESETS[0].content)
  const [mime, setMime] = useState<string | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [mode, setMode] = useState<'full' | 'simple'>('full')
  const [anchor, setAnchor] = useState<DocumentAnchor | null>(PRESETS[0].anchor)
  const [markers, setMarkers] = useState<DocumentMarker[]>(PRESETS[0].markers)
  const [highlights, setHighlights] = useState<DocumentHighlight[]>([])
  const [jumpLog, setJumpLog] = useState<string[]>([])

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl)
    }
  }, [fileUrl])

  function loadPreset(preset: Preset) {
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    setKind('text')
    setMime(null)
    setFileUrl(null)
    setFileError(null)
    setContent(preset.content)
    setExtractedText(preset.content)
    setAnchor(preset.anchor)
    setMarkers(preset.markers)
    setHighlights([])
    setJumpLog([])
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError(null)
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    const url = URL.createObjectURL(file)
    setKind('file')
    setMime(file.type)
    setFileUrl(url)
    setAnchor(null)
    setMarkers([])
    setHighlights([])
    setJumpLog([])

    if (file.type === 'application/pdf') {
      setExtracting(true)
      try {
        const buf = await file.arrayBuffer()
        const { text } = await extractPdfText(buf)
        setExtractedText(text)
      } catch (err) {
        setFileError(err instanceof Error ? err.message : String(err))
        setExtractedText('')
      } finally {
        setExtracting(false)
      }
    } else {
      // Images have no auto-extraction here (that's DeepSeek vision, a
      // server-side call) — leave the textarea editable so anchor/marker
      // offsets can still be tested manually against typed-in text.
      setExtractedText('')
    }
  }

  function setAnchorFromSelection() {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart, selectionEnd } = ta
    if (selectionStart === selectionEnd) return
    setAnchor({ start: selectionStart, end: selectionEnd, label: 'Selected excerpt' })
  }

  function addMarkerAtCursor() {
    const ta = textareaRef.current
    if (!ta) return
    markerCounter += 1
    const id = `marker-${markerCounter}`
    setMarkers((prev) => [...prev, { id, offset: ta.selectionStart }])
  }

  function removeMarker(id: string) {
    setMarkers((prev) => prev.filter((m) => m.id !== id))
  }

  const text = kind === 'text' ? content : extractedText
  const engineAsset = {
    type: kind,
    mime,
    content: kind === 'text' ? content : null,
    extractedText: text,
    url: fileUrl,
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <h1 className="app-title">Document Engine</h1>
        <p className="app-subtitle">
          Standalone preview — same DocumentViewer Osmosis embeds, exercised here with local
          presets/files instead of the real question bank.
        </p>

        <section className="app-section">
          <div className="app-section-label">Source</div>
          <div className="app-toggle-row">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => loadPreset(p)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="app-file-input">
            Load a PDF or image file…
            <input type="file" accept="application/pdf,image/*" onChange={handleFileChange} />
          </label>
          {extracting && <div className="app-hint">Extracting PDF text…</div>}
          {fileError && <div className="app-error">{fileError}</div>}
        </section>

        {kind === 'text' && (
          <section className="app-section">
            <div className="app-section-label">Text content</div>
            <textarea
              ref={textareaRef}
              className="app-textarea"
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setExtractedText(e.target.value)
              }}
              rows={10}
            />
          </section>
        )}

        {kind === 'file' && (
          <section className="app-section">
            <div className="app-section-label">
              Extracted text {mime === 'application/pdf' ? '(auto, from document-engine/core)' : '(type manually — no auto-transcription in this demo)'}
            </div>
            <textarea
              ref={textareaRef}
              className="app-textarea"
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              rows={10}
            />
          </section>
        )}

        <section className="app-section">
          <div className="app-section-label">Anchor (highlighted range)</div>
          <div className="app-toggle-row">
            <button onClick={setAnchorFromSelection}>Set from textarea selection</button>
            <button onClick={() => setAnchor(null)}>Clear</button>
          </div>
          {anchor && (
            <div className="app-hint">
              {anchor.start}–{anchor.end} {anchor.label ? `(${anchor.label})` : ''}
            </div>
          )}
        </section>

        <section className="app-section">
          <div className="app-section-label">Markers (clickable question references)</div>
          <button onClick={addMarkerAtCursor}>Add marker at cursor</button>
          <ul className="app-marker-list">
            {markers.map((m) => (
              <li key={m.id}>
                <code>{m.id}</code> @ {m.offset}
                {(() => {
                  const span = findTokenSpan(text, m.offset)
                  return span ? ` "${text.slice(span.start, span.end)}"` : ' (no token here)'
                })()}
                <button onClick={() => removeMarker(m.id)}>×</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="app-section">
          <div className="app-section-label">Highlights (select text in the viewer, click Highlight)</div>
          <ul className="app-marker-list">
            {highlights.length === 0 && <li className="app-hint">None yet — select text in the document to add one.</li>}
            {highlights.map((h) => (
              <li key={h.id}>
                <code>{h.id.slice(0, 14)}…</code> {h.start}–{h.end}
                <button onClick={() => setHighlights((prev) => prev.filter((x) => x.id !== h.id))}>×</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="app-section">
          <div className="app-section-label">View</div>
          <div className="app-toggle-row">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} className={t === theme ? 'active' : ''} onClick={() => setTheme(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="app-toggle-row">
            {(['full', 'simple'] as const).map((m) => (
              <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </section>

        <section className="app-section">
          <div className="app-section-label">onJumpToQuestion log</div>
          <ul className="app-jump-log">
            {jumpLog.length === 0 && <li className="app-hint">Click a marker to see it fire.</li>}
            {jumpLog.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="app-main">
        <DocumentViewer
          asset={engineAsset}
          theme={theme}
          mode={mode}
          anchor={anchor}
          markers={markers}
          highlights={highlights}
          onHighlightsChange={setHighlights}
          onJumpToQuestion={(id) => setJumpLog((prev) => [`${new Date().toLocaleTimeString()} → ${id}`, ...prev].slice(0, 20))}
          onErrors={(errors) => errors.length > 0 && console.warn('document render errors', errors)}
        />
      </main>
    </div>
  )
}
