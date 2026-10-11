import { useEffect, type RefObject } from 'react'

// The viewer's controls are positioned against .document-viewer, but the
// classic scrollbar of its child .document-viewer-scroll paints over that
// edge. This measures the real scrollbar (offsetWidth - clientWidth, 0 for
// overlay scrollbars) and publishes it on the toolbar as --viewer-scrollbar-width,
// which ViewerControls.css adds to the right inset. Re-measured whenever the
// scroll box changes size (a scrollbar appearing shrinks its content box).
export function useScrollbarWidth(from: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const toolbar = from.current?.closest<HTMLElement>('.document-viewer-toolbar')
    const scroll = toolbar?.parentElement?.querySelector<HTMLElement>(':scope > .document-viewer-scroll')
    if (!toolbar || !scroll) return
    const measure = () => {
      const w = Math.max(0, scroll.offsetWidth - scroll.clientWidth)
      toolbar.style.setProperty('--viewer-scrollbar-width', `${w}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(scroll)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [from])
}
