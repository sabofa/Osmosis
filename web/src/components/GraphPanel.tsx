import React, { Suspense } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { ParseError } from 'graph-engine'
// graph-engine's Vite library build extracts CSS into its own file rather
// than injecting it via the JS bundle (that's a dev-mode-only behavior) —
// without this, GraphViewer's canvas has no display/sizing rules at all and
// silently renders as an unstyled inline element sized by nothing.
import 'graph-engine/style.css'

// graph-engine pulls in `three`, which is real weight — lazy-load it so
// pages that never show a graph question don't pay for it.
const GraphViewer = React.lazy(() => import('graph-engine').then((m) => ({ default: m.GraphViewer })))

export default function GraphPanel({ spec }: { spec: string }) {
  // No shared theme context exists above this component (App.tsx calls
  // useTheme() once and only threads the result into Settings as a prop).
  // Calling the hook again here is safe: it derives resolvedMode fresh from
  // localStorage / the already-applied data-theme attribute rather than
  // owning any state the App-level instance doesn't also already own, so two
  // independent instances just stay in sync rather than fighting each other.
  const { resolvedMode } = useTheme()

  function handleErrors(errors: ParseError[]) {
    // The messages, not the objects: a console line reading `{0: Object}` is
    // no help at all when a graph comes up blank.
    if (errors.length > 0) console.warn('graph spec errors:', errors.map((e) => e.message).join('; '))
  }

  return (
    <div className="graph-panel">
      <Suspense fallback={<div className="panel-loading">Loading graph…</div>}>
        <GraphViewer spec={spec} theme={resolvedMode} onErrors={handleErrors} />
      </Suspense>
    </div>
  )
}
