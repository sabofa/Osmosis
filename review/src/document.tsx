import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Same source-not-dist reasoning as src/graph.tsx.
import '../../document-engine/src/index.css'
import App from '../../document-engine/src/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
