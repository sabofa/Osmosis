import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// katex ships its own stylesheet (fonts + layout); imported once here so every
// RichText on any page is styled.
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
