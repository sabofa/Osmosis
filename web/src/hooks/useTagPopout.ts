import { useState } from 'react'
import { getTags, type TagSummary } from '../lib/api'

// Opens a TagDetail overlay directly on top of whichever page calls this,
// instead of navigating to the Bank tab — the page that opened it stays the
// active tab underneath. Tags are real bank data (fetched lazily, once, on
// first open) even when the calling page's own content is mock data.
export function useTagPopout() {
  const [tags, setTags] = useState<TagSummary[] | null>(null)
  const [openSlug, setOpenSlug] = useState<string | null>(null)

  function openTag(slug: string) {
    setOpenSlug(slug)
    if (tags === null) {
      getTags()
        .then((r) => setTags(r.tags))
        .catch(() => setTags([]))
    }
  }

  function closeTag() {
    setOpenSlug(null)
  }

  const tag = tags?.find((t) => t.slug === openSlug) ?? null

  return { openTag, closeTag, openSlug, tags: tags ?? [], tag, loading: openSlug !== null && tags === null }
}
