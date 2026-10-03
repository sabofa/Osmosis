// What a key press means to ConfirmDialog, kept apart from the component so it
// is tested without a DOM.
//
// Enter has a meaning of its own on a focused control: on a button it presses
// that button (Cancel included, which is where focus starts, so that a stray
// Enter never destroys anything), on a checkbox it does nothing, in a text box
// it is part of typing. The dialog therefore only treats Enter as "confirm"
// when focus is on none of those, say the dialog's own text or the page, and
// never in a type-to-confirm dialog, whose button stays disabled until the
// phrase is typed.

// The facts about the focused element the decision needs.
export interface KeyTarget {
  tag: string
  type?: string
  editable?: boolean
}

// 'cancel' and 'confirm' are for the dialog to act on (and to preventDefault);
// 'native' is to be left alone, so the browser does what the focused element
// does with the key.
export type ConfirmKeyAction = 'cancel' | 'confirm' | 'native'

const OWN_ENTER = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])

export function confirmKeyAction(key: string, target: KeyTarget | null, typeToConfirm: boolean): ConfirmKeyAction {
  if (key === 'Escape') return 'cancel'
  if (key !== 'Enter' || typeToConfirm) return 'native'
  if (target && (OWN_ENTER.has(target.tag) || target.editable)) return 'native'
  return 'confirm'
}

export function keyTargetOf(t: EventTarget | null): KeyTarget | null {
  if (typeof Element === 'undefined' || !(t instanceof Element)) return null
  return { tag: t.tagName.toLowerCase(), type: (t as HTMLInputElement).type, editable: (t as HTMLElement).isContentEditable }
}
