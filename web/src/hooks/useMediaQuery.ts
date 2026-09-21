import { useEffect, useState } from 'react'

// A live answer to one media query. The portrait/narrow layouts (Take, the
// session stream) branch on this in JSX, not only in CSS, because they mount
// different components — a panel switcher instead of a side column.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// One definition of "narrow" for the whole app: a phone, a half-width window,
// or anything taller than it is wide. Below this the side panel becomes a
// switcher and the question dots move to a horizontal strip.
export const NARROW_QUERY = '(max-width: 760px), (max-aspect-ratio: 1/1)'
