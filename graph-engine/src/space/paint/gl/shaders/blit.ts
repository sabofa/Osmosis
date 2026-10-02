// Small passes: the layer copy for ping-pong, and the debug views' flat
// image and edge segments.

export const COPY_FRAGMENT = /* glsl */ `#version 300 es
// paint: copy
precision highp float;
precision highp sampler2D;
uniform sampler2D u_src0;
uniform sampler2D u_src1;
layout(location = 0) out vec4 o_0;
layout(location = 1) out vec4 o_1;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  o_0 = texelFetch(u_src0, p, 0);
  o_1 = texelFetch(u_src1, p, 0);
}
`

// A flat RGBA8 image (a debug view at G-buffer resolution) stretched over the
// canvas, nearest-filtered so the data shows as it is. Image row 0 is the top.
export const IMAGE_FRAGMENT = /* glsl */ `#version 300 es
// paint: image
precision highp float;
precision highp sampler2D;
uniform sampler2D u_image;
uniform vec2 u_resolution;  // backing px
uniform vec2 u_uvScale;     // canvas extent over the image's extent
uniform vec3 u_background;
out vec4 fragColor;
void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y) * u_uvScale;
  if (uv.x > 1.0 || uv.y > 1.0) { fragColor = vec4(u_background, 1.0); return; }
  vec4 c = texture(u_image, uv);
  fragColor = vec4(mix(u_background, c.rgb, c.a), 1.0);
}
`

// Edge segments (x0, y0, x1, y1 in CSS px, plus a class) as 3 px quads.
export const EDGE_VERTEX = /* glsl */ `#version 300 es
// paint: edge segments
layout(location = 0) in vec4 a_segment;
layout(location = 1) in float a_class;
uniform vec2 u_cssSize;
uniform float u_halfWidth;
flat out float v_class;
void main() {
  vec2 p0 = a_segment.xy;
  vec2 p1 = a_segment.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 tn = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  float along = float(gl_VertexID >> 1);
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  vec2 pos = mix(p0, p1, along) + tn * (along * 2.0 - 1.0) * u_halfWidth + vec2(-tn.y, tn.x) * side * u_halfWidth;
  v_class = a_class;
  gl_Position = vec4(pos.x / u_cssSize.x * 2.0 - 1.0, 1.0 - pos.y / u_cssSize.y * 2.0, 0.0, 1.0);
}
`

export const EDGE_FRAGMENT = /* glsl */ `#version 300 es
// paint: edge segments
precision highp float;
uniform vec3 u_classColour[4];
flat in float v_class;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_classColour[int(v_class + 0.5)], 1.0);
}
`
