// Colormap textures (plan E3): one 256 x 1 RGBA8 texture per (map, theme),
// shared by every mesh that uses the map, made from colormaps.ts's table.
// The theme is part of the key (balance's neutral is the background), so a
// theme switch makes new textures and retire() deletes the old ones.

import { colormapTable, TABLE_SIZE, type ColormapTheme } from '../colormaps'
import type { ColormapName } from '../scene/types'

export function lutKey(map: ColormapName, theme: ColormapTheme): string {
  return `${map}|${theme.theme}|${theme.background.join(',')}`
}

export class LutCache {
  private readonly textures = new Map<string, WebGLTexture>()

  get size(): number {
    return this.textures.size
  }

  // The texture for a map under a theme, made on first use.
  get(gl: WebGL2RenderingContext, map: ColormapName, theme: ColormapTheme): WebGLTexture | null {
    const key = lutKey(map, theme)
    const known = this.textures.get(key)
    if (known) return known
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TABLE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colormapTable(map, theme))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.textures.set(key, texture)
    return texture
  }

  // Delete every texture whose key is not wanted.
  retain(gl: WebGL2RenderingContext, wanted: ReadonlySet<string>): void {
    for (const [key, texture] of this.textures) {
      if (wanted.has(key)) continue
      gl.deleteTexture(texture)
      this.textures.delete(key)
    }
  }

  deleteAll(gl: WebGL2RenderingContext): void {
    this.retain(gl, new Set())
  }

  // After a context loss every handle is already dead.
  forget(): void {
    this.textures.clear()
  }
}
