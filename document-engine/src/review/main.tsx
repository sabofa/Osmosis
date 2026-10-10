// Dev-only visual review harness entry (review.html). Not exported from index.ts.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../index.css'
import ReviewPage from './ReviewPage'

const w = window as unknown as { __errors: string[] }
w.__errors = []
window.addEventListener('error', (e) => w.__errors.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => w.__errors.push(String(e.reason)))
const origErr = console.error
console.error = (...a: unknown[]) => { w.__errors.push(a.map(String).join(' ')); origErr(...a) }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReviewPage />
  </StrictMode>
)

// ?errs=1 -> dump collected errors into the DOM (for --dump-dom checks).
if (new URLSearchParams(location.search).has('errs')) {
  setTimeout(() => {
    const pre = document.createElement('pre')
    pre.id = 'errs'
    pre.textContent = 'ERRS:' + JSON.stringify(w.__errors)
    document.body.appendChild(pre)
  }, 2500)
}
