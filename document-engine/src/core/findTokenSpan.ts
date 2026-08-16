const WHITESPACE = /\s/

export interface TokenSpan {
  start: number
  end: number // exclusive
}

// Extends a raw character offset out to the boundaries of the punctuation-
// inclusive "token" it sits inside — e.g. an offset pointing at the "A" in
// "...revise (A) as follows..." expands to the full "(A)" span, not just the
// single letter. Used both to validate an author-set marker offset lands on
// a real token (not mid-whitespace) and to size the clickable/highlightable
// region the renderer draws around it. Shared between server-side validation
// and client-side rendering so both agree on exactly the same span.
export function findTokenSpan(text: string, offset: number): TokenSpan | null {
  if (text.length === 0 || offset < 0 || offset > text.length) return null

  // An offset sitting exactly on whitespace (or at the very end of the text)
  // doesn't point at a token itself — fall back to the char immediately
  // before it if that one is non-whitespace, otherwise there's no token here.
  let anchor = offset
  if (anchor >= text.length || WHITESPACE.test(text[anchor])) {
    if (anchor > 0 && !WHITESPACE.test(text[anchor - 1])) anchor -= 1
    else return null
  }

  let start = anchor
  while (start > 0 && !WHITESPACE.test(text[start - 1])) start -= 1
  let end = anchor + 1
  while (end < text.length && !WHITESPACE.test(text[end])) end += 1

  return { start, end }
}
