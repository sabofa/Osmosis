// Safari fires compositionend BEFORE the keydown that committed the
// composition (Enter, Backspace), so a key handler that only checks
// view.composing would act on the commit key. Handlers ask `composingNow`.
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const COMPOSITION_GRACE_MS = 50

const endedAt = new WeakMap<object, number>()

/** Records when each view's last composition ended. */
export const compositionGuard: Extension = EditorView.domEventHandlers({
  compositionend(_e, view) {
    endedAt.set(view, Date.now())
    return false
  },
})

/** Test hook: pretend a composition ended `ago` ms ago. */
export function markCompositionEnd(view: object, at = Date.now()): void {
  endedAt.set(view, at)
}

/** True while composing, once composition has started, or just after it ended. */
export function composingNow(view: { composing?: boolean; compositionStarted?: boolean }): boolean {
  if (view.composing || view.compositionStarted) return true
  const t = endedAt.get(view)
  return t !== undefined && Date.now() - t < COMPOSITION_GRACE_MS
}
