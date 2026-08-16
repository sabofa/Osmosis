import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    Desmos?: {
      GraphingCalculator: (el: HTMLElement) => unknown
    }
  }
}

let desmosLoadPromise: Promise<void> | null = null

function loadDesmosScript(apiKey: string): Promise<void> {
  if (window.Desmos) return Promise.resolve()
  if (desmosLoadPromise) return desmosLoadPromise
  desmosLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${apiKey}`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Desmos script'))
    document.head.appendChild(script)
  })
  return desmosLoadPromise
}

export default function DesmosPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const calculatorRef = useRef<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const apiKey = import.meta.env.VITE_DESMOS_API_KEY as string | undefined

  useEffect(() => {
    if (!apiKey) return
    let cancelled = false
    loadDesmosScript(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current || !window.Desmos) return
        calculatorRef.current = window.Desmos.GraphingCalculator(containerRef.current)
      })
      .catch((err) => setError(String(err)))
    return () => {
      cancelled = true
      const calc = calculatorRef.current as { destroy?: () => void } | null
      calc?.destroy?.()
      calculatorRef.current = null
    }
  }, [apiKey])

  if (!apiKey) {
    return (
      <div className="panel-placeholder">
        Desmos API key not configured. Set <code>VITE_DESMOS_API_KEY</code> to enable the graphing calculator.
      </div>
    )
  }

  if (error) {
    return <div className="panel-placeholder">Could not load Desmos: {error}</div>
  }

  return <div className="desmos-panel" ref={containerRef} />
}
