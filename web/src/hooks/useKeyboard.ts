import { useEffect, useRef } from 'react'
import { resolveKey, isTextEntry, type KeyAction, type KeyContext } from '../lib/keymap'

// Wires the pure key map (lib/keymap.ts) to the window. All of the deciding
// lives in `resolveKey`; this only supplies the two things it cannot know —
// where the caret is, and what to do with the action it returns.
//
// The handler is attached once and reads the latest context and callback
// through refs, so a re-render per keystroke (which is every keystroke, since
// answering changes state) never detaches and reattaches the listener.
export function useKeyboard(context: KeyContext, onAction: (action: KeyAction) => void, enabled = true) {
  const contextRef = useRef(context)
  const actionRef = useRef(onAction)
  contextRef.current = context
  actionRef.current = onAction

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      const ctx: KeyContext = {
        ...contextRef.current,
        inTextField: isTextEntry(event.target as { tagName?: string; isContentEditable?: boolean } | null),
      }
      const action = resolveKey(event, ctx)
      if (!action) return
      // Only once the map has claimed the key: Space would scroll the page and
      // Enter would re-fire whatever button happens to hold focus.
      event.preventDefault()
      actionRef.current(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
