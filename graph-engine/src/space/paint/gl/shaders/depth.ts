// The scene's depth for the current view (fix round 1, B6 and B7): the opaque meshes drawn from the view the
// strokes are about to be painted for, depth only, into an R32F target of the paint's own size. While the camera
// moves the strokes of the last full frame are re-projected onto the new view, and this is what tells which of
// them are hidden there: the stroke shader compares each fragment's view depth with it, and the underpainting's
// warp reads the surface's depth here to find where in the last frame's image each pixel was.
//
// What a texel holds (RG32F): the view depth (distance along the view direction from the eye, the number the
// G-buffer holds too) in r, 1e30 where nothing opaque is drawn, and in g whether the surface there is bare table
// (1) or not (0). A translucent mesh is not drawn (a veil hides nothing).

export const DEPTH_VERTEX = /* glsl */ `#version 300 es
// paint: depth
layout(location = 0) in vec3 a_position; // relative to the scene origin
uniform mat4 u_viewProj;                 // origin folded in
uniform vec3 u_viewDir;
uniform float u_depthBase;               // dot(origin - eye, viewDir)
out float v_depth;
void main() {
  v_depth = dot(a_position, u_viewDir) + u_depthBase;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}
`

export const DEPTH_FRAGMENT = /* glsl */ `#version 300 es
// paint: depth
precision highp float;
in float v_depth;
uniform float u_ground;                  // 1 for a mesh that is bare table
layout(location = 0) out vec4 o_depth;
void main() {
  o_depth = vec4(v_depth, u_ground, 0.0, 1.0);
}
`
