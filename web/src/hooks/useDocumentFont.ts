import { useCallback, useEffect, useState, type CSSProperties } from 'react'

export type DocumentFont = 'system' | 'serif' | 'mono'

const STORAGE_KEY = 'osmosis.documentFont'

// The actual stacks. 'system' means "whatever the app already uses" — an empty
// family so the document panel simply inherits, rather than pinning it to a
// font the theme didn't choose.
export const DOCUMENT_FONT_STACKS: Record<DocumentFont, string> = {
  system: '',
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
}

export const DOCUMENT_FONT_OPTIONS: { value: DocumentFont; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
]

// document-engine's stylesheet puts `font-family: var(--de-font-mono)` on
// `.document-viewer` itself and `font-family: inherit` on the text layer inside
// it, so setting `font-family` on our wrapper is overridden one level down and
// changes nothing. --de-font-mono is declared on :root, though, so redefining it
// on the wrapper inherits into the viewer and is what actually moves the
// document body. (index.css puts real monospace back on the few places that
// genuinely need it — code spans, the zoom control.)
export function documentFontStyle(font: DocumentFont): CSSProperties | undefined {
  const stack = DOCUMENT_FONT_STACKS[font]
  // 'system' must leave the engine's own default completely intact.
  if (!stack) return undefined
  return { fontFamily: stack, '--de-font-mono': stack } as CSSProperties
}

function readStored(): DocumentFont {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'system' || stored === 'serif' || stored === 'mono' ? stored : 'system'
}

// The Settings control and the document viewer are separate subtrees with no
// common owner, and the `storage` event only fires in *other* tabs — so the
// hook's instances share one module-level value and notify each other directly.
// Without this, picking a font in Settings wouldn't reach an already-open
// viewer until a reload.
const listeners = new Set<(font: DocumentFont) => void>()

// Which font family the document viewer renders in. Local-only (like the
// light/dark choice in useTheme), so it isn't synced to other devices.
export function useDocumentFont() {
  const [font, setFontState] = useState<DocumentFont>(readStored)

  useEffect(() => {
    listeners.add(setFontState)
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setFontState(readStored())
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(setFontState)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setFont = useCallback((choice: DocumentFont) => {
    localStorage.setItem(STORAGE_KEY, choice)
    for (const notify of listeners) notify(choice)
  }, [])

  return { font, setFont, style: documentFontStyle(font) }
}
