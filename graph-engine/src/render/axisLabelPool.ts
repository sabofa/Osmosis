import * as THREE from 'three'

const CANVAS_W = 96
const CANVAS_H = 32
const FONT_SIZE_PX = 24

interface LabelEntry {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  text: string
}

// A reusable pool of billboarded text sprites for axis tick numbers.
// GridRenderer.draw() runs on every pan/zoom frame, so labels are redrawn
// that often too — reusing the same canvas/texture/sprite per slot instead
// of allocating fresh GPU textures every frame is the same "fixed per-buffer
// cost, not a math cost" reasoning SceneRenderer already applies to point
// reuse (see its class comment), just for a different object kind here.
export class AxisLabelPool {
  readonly group = new THREE.Group()
  private entries: LabelEntry[] = []
  private color: string
  // fit: each label's canvas is sized to its text (axis titles vary in length)
  // instead of the fixed tick-label canvas.
  private fit: boolean

  constructor(color: string, fit = false) {
    this.color = color
    this.fit = fit
  }

  setColor(color: string) {
    if (this.color === color) return
    this.color = color
    for (const entry of this.entries) this.redraw(entry, entry.text)
  }

  private createEntry(): LabelEntry {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const ctx = canvas.getContext('2d')!
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    const sprite = new THREE.Sprite(material)
    this.group.add(sprite)
    const entry: LabelEntry = { sprite, canvas, ctx, texture, text: '' }
    this.entries.push(entry)
    return entry
  }

  private redraw(entry: LabelEntry, text: string) {
    const { ctx, canvas } = entry
    const font = `${FONT_SIZE_PX}px ui-monospace, SFMono-Regular, Menlo, monospace`
    if (this.fit) {
      ctx.font = font
      canvas.width = Math.max(CANVAS_H, Math.ceil(ctx.measureText(text).width) + 4) // resets the context state
      const material = entry.sprite.material as THREE.SpriteMaterial
      entry.texture.dispose()
      entry.texture = new THREE.CanvasTexture(canvas)
      entry.texture.minFilter = THREE.LinearFilter
      material.map = entry.texture
      material.needsUpdate = true
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = font
    ctx.fillStyle = this.color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    entry.texture.needsUpdate = true
    entry.text = text
  }

  // Fit-mode placement: the sprite is `heightWorld` tall, as wide as its text
  // needs, and hangs off (x, y) the way `align` / `baseline` say.
  placeAnchored(
    index: number,
    text: string,
    x: number,
    y: number,
    heightWorld: number,
    align: 'start' | 'end',
    baseline: 'top' | 'bottom' | 'middle',
  ) {
    const entry = this.entries[index] ?? this.createEntry()
    if (entry.text !== text) this.redraw(entry, text)
    const width = (heightWorld * entry.canvas.width) / entry.canvas.height
    const cx = align === 'end' ? x - width / 2 : x + width / 2
    const cy = baseline === 'bottom' ? y + heightWorld / 2 : baseline === 'top' ? y - heightWorld / 2 : y
    entry.sprite.position.set(cx, cy, 0.01)
    entry.sprite.scale.set(width, heightWorld, 1)
    entry.sprite.visible = true
  }

  // Places (creating/reusing as needed) label `index` at world position
  // (x, y) sized (scaleX, scaleY) world units. Pooled entries beyond however
  // many `place` calls happen this frame are hidden via hideFrom, not
  // disposed — cheap to keep around for the next frame that needs more.
  place(index: number, text: string, x: number, y: number, scaleX: number, scaleY: number) {
    const entry = this.entries[index] ?? this.createEntry()
    if (entry.text !== text) this.redraw(entry, text)
    entry.sprite.position.set(x, y, 0.01)
    entry.sprite.scale.set(scaleX, scaleY, 1)
    entry.sprite.visible = true
  }

  hideFrom(index: number) {
    for (let i = index; i < this.entries.length; i++) this.entries[i].sprite.visible = false
  }

  dispose() {
    for (const entry of this.entries) {
      entry.texture.dispose()
      ;(entry.sprite.material as THREE.SpriteMaterial).dispose()
    }
    this.entries = []
  }
}
