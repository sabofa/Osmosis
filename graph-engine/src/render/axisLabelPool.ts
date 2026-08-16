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

  constructor(color: string) {
    this.color = color
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
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `${FONT_SIZE_PX}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.fillStyle = this.color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    entry.texture.needsUpdate = true
    entry.text = text
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
