// The browser half of generated papers: a figure's SVG holds an empty `<image data-paper-key=KEY>` and this fills
// it. DOM only. NEVER import this from figure/, the parser, or any index.ts.

import { toOklch } from '../color'
import { parsePaperKey, paperKeysIn } from './generated'
import { colourisePaper, generatePaper } from './generate'
import { encodePng, pngFromZlib, pngScanlines } from './png'

type Tile = { size: number; rgba: Uint8ClampedArray }

function oklabOf(hex: string): [number, number, number] {
  const { l, c, h } = toOklch(hex)
  const rad = (h * Math.PI) / 180
  return [l, c * Math.cos(rad), c * Math.sin(rad)]
}

// A key's tile as RGBA. The tile is generated at the style's texture and coloured at 1 (colourise.ts: the two multiply).
export function tilePixels(key: string): Tile | null {
  const parsed = parsePaperKey(key)
  if (!parsed) return null
  const tile = generatePaper(parsed.type, { seed: String(parsed.seed), size: parsed.size, texture: parsed.texture })
  return { size: parsed.size, rgba: colourisePaper(tile, oklabOf(parsed.baseHex), 1) }
}

// Fill every empty `href=""` of an `<image data-paper-key=KEY>` for the keys given, leaving the rest byte-identical.
export function setHrefs(svg: string, hrefs: ReadonlyMap<string, string>): string {
  return svg.replace(/<image\b[^>]*>/g, (tag) => {
    const key = /data-paper-key="([^"]*)"/.exec(tag)?.[1]
    const url = key === undefined ? undefined : hrefs.get(key)
    if (url === undefined || !/\bhref=""/.test(tag)) return tag
    return tag.replace(/\bhref=""/, () => `href="${url}"`)
  })
}

const blobUrls = new Map<string, Promise<string | null>>()

async function blobUrlFor(key: string): Promise<string | null> {
  const tile = tilePixels(key)
  if (!tile) return null
  const data = new ImageData(new Uint8ClampedArray(tile.rgba), tile.size, tile.size)
  let blob: Blob | null
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(tile.size, tile.size)
    canvas.getContext('2d')!.putImageData(data, 0, 0)
    blob = await canvas.convertToBlob({ type: 'image/png' })
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = tile.size
    canvas.getContext('2d')!.putImageData(data, 0, 0)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  }
  return blob ? URL.createObjectURL(blob) : null
}

// Keys of the cache that no `<image data-paper-key>` under doc uses. Pure, so it can be tested alone.
export function unusedKeys(cached: Iterable<string>, inUse: ReadonlySet<string>): string[] {
  return Array.from(cached).filter((key) => !inUse.has(key))
}

// Revoke the blob URL of every cached key no image in doc uses any more, and drop the cache entry. A tile still
// generating or that failed has no URL to revoke; its entry is only dropped.
export function releaseUnusedPaperTiles(doc: ParentNode = document): void {
  const inUse = new Set(Array.from(doc.querySelectorAll<SVGImageElement>('image[data-paper-key]')).map((image) => image.getAttribute('data-paper-key')!))
  for (const key of unusedKeys(blobUrls.keys(), inUse)) {
    const pending = blobUrls.get(key)!
    blobUrls.delete(key)
    void pending.then((url) => {
      if (url) URL.revokeObjectURL(url)
    }, () => {})
  }
}

// Fill every empty paper `<image>` under root, generating each distinct tile once per page.
export async function fillPaperTiles(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll<SVGImageElement>('image[data-paper-key]'))
  const keys = new Set(images.map((image) => image.getAttribute('data-paper-key')!))
  for (const key of keys) {
    if (blobUrls.has(key)) continue
    // A tile that fails is forgotten, so a later fill may try it again; it never reaches the other keys.
    const pending = blobUrlFor(key)
    blobUrls.set(key, pending)
    pending.catch(() => {
      if (blobUrls.get(key) === pending) blobUrls.delete(key)
    })
  }
  for (const image of images) {
    const key = image.getAttribute('data-paper-key')!
    const href = image.getAttribute('href')
    if (href) continue
    let url: string | null = null
    try {
      url = (await blobUrls.get(key)) ?? null
    } catch {
      url = null // a bad key leaves its own images empty and nothing else
    }
    if (url) image.setAttribute('href', url)
  }
}

async function deflateWithStream(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// For export: each empty paper href becomes a data:image/png;base64 URL, every tile generated once.
export async function inlinePaperTiles(svg: string): Promise<string> {
  const hrefs = new Map<string, string>()
  for (const key of paperKeysIn(svg)) {
    const tile = tilePixels(key)
    if (!tile) continue
    const png =
      typeof CompressionStream !== 'undefined'
        ? pngFromZlib(tile.size, tile.size, await deflateWithStream(pngScanlines(tile.size, tile.size, tile.rgba)))
        : encodePng(tile.size, tile.size, tile.rgba)
    hrefs.set(key, `data:image/png;base64,${base64Of(png)}`)
  }
  return setHrefs(svg, hrefs)
}
