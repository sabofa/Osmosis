import * as THREE from 'three'

// three.js does not free WebGL buffers/textures on its own when an object is
// removed from the scene graph — gl.deleteBuffer only ever gets called from
// an explicit .dispose(), never from JS garbage collection. Every place that
// clears a group of built objects needs to walk it and dispose first, or the
// GPU-side memory leaks for as long as the tab stays open.
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh | THREE.Line
    if ('geometry' in mesh && mesh.geometry) {
      mesh.geometry.dispose()
    }
    if ('material' in mesh && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        // Sprite materials (point/vector labels) own a canvas texture.
        const map = (material as THREE.SpriteMaterial | THREE.MeshBasicMaterial).map
        if (map) map.dispose()
        material.dispose()
      }
    }
  })
}

// Disposes every current child of `group`, then clears it — the drop-in
// replacement for `group.clear()` everywhere a rebuilt scene/grid/hover
// group is repopulated.
export function clearAndDispose(group: THREE.Group): void {
  for (const child of group.children) disposeObject3D(child)
  group.clear()
}
