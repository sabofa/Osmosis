// URL allow-lists for pasted HTML. Anything not positively known to be safe is
// dropped (the link text / image alt stays), so `javascript:`, `vbscript:`,
// `data:` and every obfuscation of them (tabs, newlines, control characters,
// zero-width characters, mixed case) are refused without listing them.

/** Drop control / whitespace / zero-width characters, the way a browser URL parser ignores them. */
export function normalizeUrl(url: string): string {
  let out = ''
  for (const ch of url) {
    const c = ch.charCodeAt(0)
    if (c > 0x20 && (c < 0x7f || c > 0xa0)) out += ch
  }
  return out
}

const SAFE_LINK = /^(?:https?:|mailto:|tel:|#|\/|\.\.?\/)/i

/** A link target that is safe to keep: http(s), mailto, tel, a fragment, or a relative path. */
export function isSafeHref(href: string | null | undefined): boolean {
  if (!href) return false
  return SAFE_LINK.test(normalizeUrl(href))
}

export const MAX_INLINE_DATA_URL = 2048
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i

/** An image source that is safe to keep: http(s), or a small raster data: URL. */
export function isSafeImgSrc(src: string | null | undefined): boolean {
  if (!src) return false
  const u = normalizeUrl(src)
  if (/^https?:\/\//i.test(u)) return true
  return u.length <= MAX_INLINE_DATA_URL && SAFE_DATA_IMAGE.test(u)
}
