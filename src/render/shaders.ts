/**
 * GLSL shared by the sky passes. All directions live on the unit sphere.
 *
 * Star pipeline (per vertex):
 *   J2000 dir -> proper motion (years since epoch) -> first-order aberration
 *   -> ICRS->horizontal rotation -> stereographic projection to clip space.
 * No per-frame CPU work over the million-star buffers.
 */

export const COMMON_UNIFORMS_GLSL = /* glsl */ `
uniform mat3 uRotEqjToHor;   // J2000 ICRS -> local horizontal
uniform vec3 uBeta;          // observer velocity / c, ICRS frame
uniform float uYears;        // years since catalog epoch (J2000.0)
uniform vec3 uCamCenter;     // view center, horizontal frame
uniform vec3 uCamUp;
uniform vec3 uCamRight;
uniform float uScaleTan;     // tan(fov/4)
uniform float uAspect;       // canvas width / height
`;

/** J2000 direction + proper motion -> apparent direction in ICRS. */
export const APPARENT_GLSL = /* glsl */ `
vec3 applyProperMotionAndAberration(vec3 dir, vec2 pm) {
  const float MAS_TO_RAD = 4.84813681109536e-9;
  vec3 east = normalize(vec3(-dir.y, dir.x, 0.0));
  vec3 north = cross(dir, east);
  vec3 d = dir + east * (pm.x * MAS_TO_RAD * uYears) + north * (pm.y * MAS_TO_RAD * uYears);
  d = normalize(d);
  float bn = dot(uBeta, d);
  return normalize(d + uBeta - bn * d);
}
`;

/**
 * Horizontal-frame direction -> clip-space stereographic coordinates.
 * Returns vec4; w=0 marks "offscreen" (caller should emit a culled position).
 */
export const STEREO_PROJECT_GLSL = /* glsl */ `
vec4 stereoProject(vec3 h) {
  float z = dot(h, uCamCenter);
  if (z <= 0.0) return vec4(0.0, 0.0, 2.0, 0.0);
  float sinTheta = sqrt(max(0.0, 1.0 - z * z));
  float r = (sinTheta / (1.0 + z)) / uScaleTan;
  float px = dot(h, uCamRight) / sinTheta * r;
  float py = dot(h, uCamUp) / sinTheta * r;
  return vec4(px / uAspect, py, 0.0, 1.0);
}
`;

export const STAR_VERTEX = /* glsl */ `
// NOTE: the J2000 unit direction is bound to the built-in position attribute
// (THREE requires a position attribute to draw anything).
attribute float mag;
attribute float bv;
attribute vec2 pm;

varying float vBrightness;
varying float vCoreBoost;
varying vec3 vColor;

uniform float uStarScale;      // base point size in pixels (device px)
uniform float uLimitMag;       // fainter than this -> invisible
uniform float uExtinctionK;    // mag/airmass, scaled by atmosphere slider
uniform sampler2D uBvLut;

${COMMON_UNIFORMS_GLSL}
${APPARENT_GLSL}
${STEREO_PROJECT_GLSL}

void main() {
  vec3 d = applyProperMotionAndAberration(position, pm);
  vec3 h = uRotEqjToHor * d;

  // Atmospheric extinction by airmass (flat-earth approx, clamped).
  float sinAlt = clamp(h.z, -1.0, 1.0);
  float airmass = clamp(1.0 / max(sinAlt, 0.03), 1.0, 32.0);
  float magEff = mag + uExtinctionK * (airmass - 1.0);

  float vis = 1.0 / (1.0 + exp((magEff - uLimitMag) * 2.2));
  vBrightness = exp(-max(magEff, -2.0) * 0.42) * vis;

  float sizePx = uStarScale * exp(-max(magEff, -2.0) * 0.30);
  gl_PointSize = clamp(sizePx, 1.25, 96.0);
  vCoreBoost = clamp(sizePx / 3.0, 0.35, 1.6);

  vec2 lutUv = vec2(clamp((bv + 0.4) / 2.4, 0.0, 1.0), 0.5);
  vColor = texture2D(uBvLut, lutUv).rgb;

  vec4 clip = stereoProject(h);
  if (clip.w == 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  } else {
    gl_Position = clip;
  }
}
`;

export const STAR_FRAGMENT = /* glsl */ `
precision mediump float;
varying float vBrightness;
varying float vCoreBoost;
varying vec3 vColor;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float t = length(q) * 2.0; // 0 center .. 1 edge
  float core = exp(-t * t * 10.0);
  float halo = exp(-t * t * 2.6) * 0.32;
  float a = (core + halo) * vBrightness;
  if (a < 0.004) discard;
  vec3 c = mix(vColor, vec3(1.0), core * 0.55);
  gl_FragColor = vec4(c * vCoreBoost, a);
}
`;

/** Lines whose vertices are J2000 directions (equatorial grid, constellations). */
export const LINE_EQJ_VERTEX = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${STEREO_PROJECT_GLSL}
void main() {
  vec3 h = uRotEqjToHor * position;
  vec4 clip = stereoProject(h);
  gl_Position = clip.w == 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : clip;
}
`;

/** Lines whose vertices are already in the horizontal frame (horizon grid). */
export const LINE_HOR_VERTEX = /* glsl */ `
uniform vec3 uCamCenter2;
uniform vec3 uCamUp2;
uniform vec3 uCamRight2;
uniform float uScaleTan2;
uniform float uAspect2;
vec4 stereoProjectHor(vec3 h) {
  float z = dot(h, uCamCenter2);
  if (z <= 0.0) return vec4(0.0, 0.0, 2.0, 0.0);
  float sinTheta = sqrt(max(0.0, 1.0 - z * z));
  float r = (sinTheta / (1.0 + z)) / uScaleTan2;
  float px = dot(h, uCamRight2) / sinTheta * r;
  float py = dot(h, uCamUp2) / sinTheta * r;
  return vec4(px / uAspect2, py, 0.0, 1.0);
}
void main() {
  vec4 clip = stereoProjectHor(dir);
  gl_Position = clip.w == 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : clip;
}
`;

export const LINE_FRAGMENT = /* glsl */ `
precision mediump float;
uniform vec4 uLineColor;
void main() {
  gl_FragColor = uLineColor;
}
`;
