import { useEffect, useRef, type ReactNode } from 'react'
import './ConfirmDialog.css'

// Enter on a focused checkbox is not a confirm: someone who has just ticked an
// option on a destructive dialog has not yet pressed the button.
const isCheckbox = (t: EventTarget | null): boolean => t instanceof HTMLInputElement && t.type === 'checkbox'

// One confirm for the whole app: leaving a test, submitting with blanks,
// clearing data. A native window.confirm would do the job but cannot be
// styled, cannot carry a second line, and blocks the SSE stream's timers in
// some browsers. Enter confirms, Escape cancels, focus starts on Cancel so a
// stray Enter never destroys anything.
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  typeToConfirm,
  children,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  // When set, the confirm button only enables once this exact text is typed.
  typeToConfirm?: string
  // Extra controls between the body and the buttons (the workspace's destroy
  // asks whether to take the items under it too).
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(typeToConfirm ? inputRef.current : cancelRef.current)?.focus()
  }, [typeToConfirm])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && !typeToConfirm && !isCheckbox(e.target)) {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onConfirm, onCancel, typeToConfirm])

  return (
    <div className="confirm-veil" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div id="confirm-title" className="confirm-title">
          {title}
        </div>
        {body && <div className="confirm-body">{body}</div>}
        {children}
        {typeToConfirm && (
          <input
            ref={inputRef}
            className="confirm-input"
            placeholder={`Type ${typeToConfirm} to continue`}
            onChange={(e) => {
              const ok = e.target.value === typeToConfirm
              e.target.dataset.ok = ok ? '1' : ''
              const btn = e.target.parentElement?.querySelector<HTMLButtonElement>('.confirm-go')
              if (btn) btn.disabled = !ok
            }}
          />
        )}
        <div className="confirm-actions">
          <button ref={cancelRef} className="confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`confirm-btn confirm-go${danger ? ' danger' : ' primary'}`}
            onClick={onConfirm}
            disabled={!!typeToConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
