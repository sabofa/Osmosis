import { useCallback, useEffect, useRef, useState } from 'react'
import './coordinateTool.css'

// The coordinate tool's face: a toggle in the view's corner and, open, three
// readout lines and a Copy button. It decides nothing. What the lines say and
// what Copy writes are worked out by the engine (figure/focusLine.ts for a
// figure) and handed in as text, so a table or a flowchart gets the same tool
// by supplying its own.

// How long "Copied" stays on the button.
export const COPIED_MS = 1500

export interface CoordinateToolProps {
  open: boolean
  onToggle(): void
  // Where the pointer is, where the view is centred, and how far it is zoomed.
  cursor: string
  centre: string
  zoom: string
  // What Copy puts on the clipboard.
  copyText: string
  theme?: 'light' | 'dark'
}

export function CoordinateTool({ open, onToggle, cursor, centre, zoom, copyText, theme = 'light' }: CoordinateToolProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(() => {
    // No clipboard (an insecure origin, an old browser) or a refusal: say
    // nothing rather than claim a copy that did not happen.
    navigator.clipboard?.writeText(copyText).then(
      () => {
        setCopied(true)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          setCopied(false)
        }, COPIED_MS)
      },
      () => {},
    )
  }, [copyText])

  return (
    <div className={`coordinate-tool coordinate-tool-${theme}`}>
      <button
        type="button"
        className="coordinate-tool-toggle"
        aria-label="Coordinates"
        aria-expanded={open}
        title="Coordinates (C)"
        onClick={onToggle}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M2 2v12h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8.5" cy="7.5" r="1.75" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="coordinate-tool-panel" role="group" aria-label="Coordinates">
          <dl className="coordinate-tool-lines">
            <dt>Cursor</dt>
            <dd>{cursor}</dd>
            <dt>Centre</dt>
            <dd>{centre}</dd>
            <dt>Zoom</dt>
            <dd>{zoom}</dd>
          </dl>
          <button type="button" className="coordinate-tool-copy" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}
