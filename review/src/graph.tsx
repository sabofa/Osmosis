import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Straight from graph-engine's own source, not its dist/ build: this harness
// is for reviewing whatever is checked out right now, so an edit to the
// parser/renderer shows up here on save without a `build:lib` in between.
import '../../graph-engine/src/index.css'
import App from '../../graph-engine/src/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
