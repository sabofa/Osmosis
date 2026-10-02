import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PaintLab } from './paintLabPage'
import './paintLab.css'

// The Paint Lab's entry (review/paint-lab.html). The page is paintLabPage.tsx;
// the view, the controls and the Showcase are paintLabStage.tsx,
// paintLabControls.tsx and paintLabShowcaseView.tsx.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PaintLab />
  </StrictMode>,
)
