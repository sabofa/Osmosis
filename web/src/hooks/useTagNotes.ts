import { useEffect, useState } from 'react'

const PREFIX = 'osmosis:tag-notes:'

// Personal, local-only notes per tag — there's no backend concept of this
// (the bank's tag table is Claude-authored content), so this deliberately
// never leaves the device.
export function useTagNotes(slug: string) {
  const [notes, setNotesState] = useState('')

  useEffect(() => {
    setNotesState(localStorage.getItem(PREFIX + slug) ?? '')
  }, [slug])

  function save(next: string) {
    setNotesState(next)
    if (next.trim()) localStorage.setItem(PREFIX + slug, next)
    else localStorage.removeItem(PREFIX + slug)
  }

  return { notes, save }
}
