import * as THREE from 'three'

// Osmosis's dark-theme --bad (see web/src/index.css) — a warm brick-red that
// reads clearly against either a light or dark canvas, matching the fixed
// (non-theme-switching) treatment the 2D hover dot/label uses for the same reason.
export const POINT_COLOR = 0xc76a5c

// Small billboarded text label used next to labeled points, in both the 2D
// and 3D renderers.
export function makeLabelSprite(text: string, color: number = POINT_COLOR): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = '32px sans-serif'
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 4, 32)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.9, 0.45, 1)
  return sprite
}
