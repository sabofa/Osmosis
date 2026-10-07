// The shared paper generator's contract (spec 2026-10-02-painted-figures-
// design.md §5). A paper tile is structure, not colour: per-texel OKLab
// offsets around a base tone plus a height ("tooth") channel, so a theme or a
// custom tint recolours it with a cheap per-texel pass. Seeded and tileable.
// style/ is owned by the geometry agent, who reviews this module before it
// reaches milestone-a/main.

export type GeneratedPaperType =
  | 'canvas'
  | 'linen'
  | 'paperFine'
  | 'paperRough'
  | 'kraft'
  | 'notebook'
  | 'graphPaper'
  | 'dotted'
  | 'blackboard'
  | 'greenboard'
  | 'whiteboard'

export interface PaperTile {
  type: GeneratedPaperType
  size: number // square, texels
  // OKLab offsets (dL, da, db) per texel, added to the base tone.
  offsets: Float32Array // 3·size²
  // Height 0..1 per texel (the tooth / weave relief).
  height: Float32Array // size²
}

export interface PaperSettings {
  // 0 flat .. 1 the type's default relief .. 2 strong.
  texture: number
  seed: string
  size?: number // default 1024 (a figure's paper uses 512: style.paper.tile)
}

export type GeneratePaper = (type: GeneratedPaperType, settings: PaperSettings) => PaperTile
// Base tone (OKLab) applied to a tile, lit at a grazing angle by the height:
// RGBA8 (sRGB) texels, alpha 255.
export type ColourisePaper = (tile: PaperTile, base: [number, number, number], texture: number) => Uint8ClampedArray
