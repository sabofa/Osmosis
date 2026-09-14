import { useCallback, useRef, useState } from 'react'

function readStored(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback
}

// Drives a draggable divider bar between a question's main content and its
// side panel (graph/Desmos/document). The handle sits to the *left* of the
// panel, so dragging it toward the main content (leftward) should grow the
// panel — hence `startWidth - dx` rather than `+ dx`.
export function usePanelWidth(storageKey: string, defaultWidth: number, min: number, max: number) {
  const [width, setWidth] = useState(() => readStored(storageKey, defaultWidth, min, max))
  const widthRef = useRef(width)
  widthRef.current = width

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = widthRef.current

      function onMove(ev: PointerEvent) {
        const dx = ev.clientX - startX
        setWidth(Math.min(max, Math.max(min, startWidth - dx)))
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        localStorage.setItem(storageKey, String(widthRef.current))
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [min, max, storageKey]
  )

  return { width, onPointerDown }
}
