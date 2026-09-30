/**
 * GLSL 着色器集中定义。
 *
 * 所有天体元素共享同一条顶点变换链（与 astro/ 的 CPU 公式一致）：
 *   EQJ 单位向量 →（自行切平面一阶外推）→ EQD 旋转（岁差+章动）
 *   → 周年光行差 → 地平旋转 → 立体投影 NDC
 * 坐标转换全部在 GPU 上按矩阵完成，CPU 每帧只更新少量 uniform。
 */

/** 星点/线/太阳系共用的 uniform 声明。 */
const COMMON_UNIFORMS = /* glsl */ `
uniform mat3 uEqd;            // EQJ → EQD（行主序数值按列主序传入）
uniform mat3 uHor;            // EQD → 地平
uniform vec3 uBeta;           // 地球速度 β（EQD 系）
uniform float uYears;         // 自 J2000 年数
uniform vec3 uRight;          // 相机基（地平系）
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uRmax;          // 2·tan(fovY/4)
uniform float uAspect;        // 宽高比
uniform float uAtm;           // 大气浓度 0..1
uniform float uKv;            // V 波段消光系数（mag/airmass）
`;

/** EQJ 向量（含自行属性）→ 地平系方向的完整链路。 */
const DIR_FROM_EQJ = /* glsl */ `
vec3 eqjToHorizon(vec3 posEqj, vec2 pmMasYr) {
  float ra = atan(posEqj.y, posEqj.x);
  float dec = asin(clamp(posEqj.z, -1.0, 1.0));
  float ca = cos(ra), sa = sin(ra);
  float cd = cos(dec), sd = sin(dec);
  vec3 eA = vec3(-sa, ca, 0.0);
  vec3 eD = vec3(-sd * ca, -sd * sa, cd);
  const float MAS2RAD = 4.84813681109536e-9;
  vec3 u0 = posEqj + uYears * MAS2RAD * (pmMasYr.x * eA + pmMasYr.y * eD);
  vec3 u1 = normalize(uEqd * u0);
  vec3 u2 = normalize(u1 + uBeta - dot(u1, uBeta) * u1);
  return uHor * u2;
}
`;

/** 地平方向 → 立体投影 NDC；返回 w=θ（与视线夹角，弧度）。 */
const PROJECT_H = /* glsl */ `
vec4 projectHorizon(vec3 h) {
  float ct = clamp(dot(h, uFwd), -1.0, 1.0);
  float theta = acos(ct);
  vec3 rp = h - ct * uFwd;
  float sp = length(rp);
  float r = 2.0 * tan(theta * 0.5);
  if (sp > 1e-9) {
    rp /= sp;
  } else {
    rp = vec3(0.0);
  }
  float x = dot(rp, uRight) * r / (uRmax * uAspect);
  float y = dot(rp, uUp) * r / uRmax;
  return vec4(x, y, theta, 1.0);
}
`;

const AIRMASS = /* glsl */ `
float airmassFn(float altDeg) {
  float h = max(altDeg, 0.1);
  return 1.0 / (sin(h * 0.017453292519943295)
                + 0.50572 * pow(h + 6.07995, -1.6364));
}
`;

/** B−V → 线性 RGB（与 astro/color.ts 同锚点）。 */
const BV_COLOR = /* glsl */ `
vec3 bvColor(float bv) {
  bv = clamp(bv, -0.4, 2.0);
  vec3 c0 = vec3(0.61, 0.69, 1.00);
  vec3 c1 = vec3(0.79, 0.84, 1.00);
  vec3 c2 = vec3(0.98, 0.99, 1.00);
  vec3 c3 = vec3(1.00, 0.96, 0.92);
  vec3 c4 = vec3(1.00, 0.82, 0.63);
  vec3 c5 = vec3(1.00, 0.69, 0.44);
  vec3 c6 = vec3(1.00, 0.60, 0.40);
  if (bv < 0.0)  return mix(c0, c1, (bv + 0.4) / 0.4);
  if (bv < 0.3)  return mix(c1, c2, bv / 0.3);
  if (bv < 0.58) return mix(c2, c3, (bv - 0.3) / 0.28);
  if (bv < 0.81) return mix(c3, c4, (bv - 0.58) / 0.23);
  if (bv < 1.4)  return mix(c4, c5, (bv - 0.81) / 0.59);
  return mix(c5, c6, (bv - 1.4) / 0.6);
}
`;

// ---------------------------------------------------------------------------
// 星点
// ---------------------------------------------------------------------------

export const STAR_VERT = /* glsl */ `
precision highp float;
${COMMON_UNIFORMS}
${DIR_FROM_EQJ}
${PROJECT_H}
${AIRMASS}
attribute float aMag;
attribute float aBv;
attribute vec2 aPm;
uniform float uPixelScale;    // 星点像素尺度（含屏高与 FOV 补偿）
uniform float uMagLimit;      // 该档渲染的极限星等
varying float vMag;
varying float vBv;
varying float vAlpha;

void main() {
  vec3 h = eqjToHorizon(position, aPm);
  float altDeg = degrees(asin(clamp(h.z, -1.0, 1.0)));
  float mag = aMag + uKv * uAtm * airmassFn(altDeg);
  vMag = mag;
  vBv = aBv;
  // 地平线以下渐隐（含轻度折射预留）：alt ≥ −0.15° 全亮，≤ −0.6° 隐藏
  vAlpha = smoothstep(-0.6, -0.15, altDeg);
  if (mag > uMagLimit || vAlpha <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec4 p = projectHorizon(h);
  if (p.z > 2.75) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = vec4(p.x, p.y, 0.0, 1.0);
  float size = uPixelScale * pow(10.0, -0.14 * (mag - 6.5)) + 1.2;
  gl_PointSize = clamp(size, 1.0, 42.0);
}
`;

export const STAR_FRAG = /* glsl */ `
precision highp float;
${BV_COLOR}
varying float vMag;
varying float vBv;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float lum = pow(10.0, -0.32 * (vMag - 6.5));      // 相对亮度
  float core = exp(-r2 * 7.0);
  float halo = 0.32 * exp(-r2 * 2.2);
  float a = (core + halo) * min(lum, 1.6) * vAlpha;
  a *= 1.0 - smoothstep(0.55, 1.0, sqrt(r2));
  gl_FragColor = vec4(bvColor(vBv), clamp(a, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------------------
// 线条（星座连线、赤道/地平网格、地平线）
// ---------------------------------------------------------------------------

export const LINE_VERT = /* glsl */ `
precision highp float;
${COMMON_UNIFORMS}
${PROJECT_H}
attribute float aDash;      // 0 = 实线（网格），0.5 = 半透明（连线），1 = 地平线
uniform float uSpace;       // 0 = EQJ 输入；2 = 地平系输入
varying float vDash;
varying float vAltDeg;

void main() {
  vec3 p = normalize(position);
  vec3 h = uSpace > 1.5 ? p : (uHor * (uEqd * p));
  vDash = aDash;
  vAltDeg = degrees(asin(clamp(h.z, -1.0, 1.0)));
  vec4 p4 = projectHorizon(h);
  if (p4.z > 2.75) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = vec4(p4.x, p4.y, 0.0, 1.0);
}
`;

export const LINE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLineColor;
uniform float uLineOpacity;
varying float vDash;
varying float vAltDeg;

void main() {
  float a = uLineOpacity;
  if (vDash > 0.25 && vDash < 0.75) a *= 0.45;              // 星座连线更淡
  a *= 1.0 - smoothstep(-2.0, 0.0, -vAltDeg);               // 地平以下渐隐
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uLineColor, a);
}
`;

// ---------------------------------------------------------------------------
// 背景：银河全景 + 天光（月光 / 晨昏）全屏 pass
// ---------------------------------------------------------------------------

export const BG_VERT = /* glsl */ `
precision highp float;
attribute vec2 aNdc;
varying vec2 vNdc;
void main() {
  vNdc = aNdc;
  gl_Position = vec4(aNdc, 0.0, 1.0);
}
`;

export const BG_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMilky;
uniform float uMilkyOpacity;
uniform mat3 uHorToGal;      // 地平 → 银道（CPU 合并矩阵）
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uRmax;
uniform float uAspect;
uniform float uSkyGlow;      // 月光天光 0..~1
uniform vec3 uSunDirHor;     // 太阳方向（地平系）
uniform float uSunAltDeg;    // 太阳高度角
uniform float uAtm;
varying vec2 vNdc;

void main() {
  // 逆立体投影：NDC → 天球方向
  vec2 q = vec2(vNdc.x * uAspect, vNdc.y) * uRmax;
  float rho2 = dot(q, q);
  float d = 4.0 + rho2;
  vec3 dir = normalize(
    (4.0 * q.x / d) * uRight + (4.0 * q.y / d) * uUp + ((4.0 - rho2) / d) * uFwd);

  float altDeg = degrees(asin(clamp(dir.z, -1.0, 1.0)));

  // 银河全景（等距圆柱，银道坐标 → UV）
  vec3 gal = uHorToGal * dir;
  float l = atan(gal.y, gal.x);
  float b = asin(clamp(gal.z, -1.0, 1.0));
  vec2 uv = vec2(l / 6.283185307179586 + 0.5, b / 3.141592653589793 + 0.5);
  vec3 mw = texture2D(uMilky, uv).rgb;

  // 天光：月光（全屏抬升 + 地平增强）
  float haze = 0.45 + 0.55 * exp(-max(altDeg, 0.0) / 22.0);
  vec3 glowCol = vec3(0.085, 0.105, 0.16) * uSkyGlow * haze * 1.6;

  // 晨昏蒙影（太阳在地平线附近时，太阳方向的暖色渐变）
  float tw = 1.0 - smoothstep(-18.0, -2.0, uSunAltDeg);      // 太阳越低越弱
  tw *= smoothstep(-30.0, -14.0, uSunAltDeg);                // 深夜消失
  float cosAng = max(dot(dir, uSunDirHor), 0.0);
  float dirGlow = pow(cosAng, 3.0);
  vec3 twiCol = vec3(0.42, 0.21, 0.11)
      * tw * dirGlow * exp(-max(altDeg, 0.0) / 12.0) * 1.8;

  // 大气浓度统一缩放天光（0 = 无大气 → 纯黑 + 银河全显）
  vec3 sky = (glowCol + twiCol) * uAtm;

  // 天光越强，银河越被冲淡
  float wash = clamp(dot(sky, vec3(1.0)) * 6.0, 0.0, 0.85);
  vec3 col = mw * uMilkyOpacity * (1.0 - wash) + sky;

  // 地平线以下压暗（地面遮挡的暗示）
  col *= 0.45 + 0.55 * smoothstep(-6.0, 0.0, altDeg);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// 太阳系天体（太阳、月亮、八大行星）圆盘
// ---------------------------------------------------------------------------

export const SOLAR_VERT = /* glsl */ `
precision highp float;
${COMMON_UNIFORMS}
${PROJECT_H}
attribute vec3 aDir;      // EQD 系单位方向（引擎已含光行差）
attribute float aDiam;    // 角径（度）
attribute vec3 aColor;
attribute float aKind;    // 0 太阳 1 月亮 2 行星
attribute float aIllum;   // 月相照亮比 0..1
attribute float aMag;
uniform float uViewportH; // 像素
varying vec3 vColor;
varying float vKind;
varying float vIllum;
varying float vAltDeg;

void main() {
  vec3 h = uHor * aDir;
  vAltDeg = degrees(asin(clamp(h.z, -1.0, 1.0)));
  vColor = aColor;
  vKind = aKind;
  vIllum = aIllum;
  vec4 p = projectHorizon(h);
  if (p.z > 2.75) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = vec4(p.x, p.y, 0.0, 1.0);
  // 角径 → 像素：视场角 fovY 对应 uViewportH 像素
  float fovY = 4.0 * atan(uRmax / 2.0) * 57.29577951308232;
  float px = aDiam / fovY * uViewportH;
  if (aKind > 1.5) px = max(px, 3.0);                       // 行星保底可见
  if (aKind < 0.5) px = max(px, 12.0);                      // 太阳光晕基底
  gl_PointSize = clamp(px, 1.0, 220.0);
}
`;

export const SOLAR_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uMoonLitDir;   // 月盘屏幕平面上的受光方向
uniform float uAtm;
varying vec3 vColor;
varying float vKind;
varying float vIllum;
varying float vAltDeg;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = length(d);
  if (r > 1.0) discard;
  float alpha = smoothstep(-0.6, 0.0, vAltDeg);              // 地平下渐隐
  if (alpha <= 0.0) discard;

  if (vKind < 0.5) {
    // 太阳：亮核 + 光晕
    float glow = exp(-r * 2.2);
    float core = smoothstep(0.34, 0.28, r);
    vec3 col = vColor * (core * 1.4 + glow * 0.8);
    gl_FragColor = vec4(col, clamp(core + glow * 0.55, 0.0, 1.0) * alpha);
    return;
  }
  if (vKind < 1.5) {
    // 月亮：terminator 椭圆（axis = 1−2f，受光方向为正）
    float axis = 1.0 - 2.0 * vIllum;
    float sx = dot(d, uMoonLitDir);
    float sy = dot(d, vec2(-uMoonLitDir.y, uMoonLitDir.x));
    float term = axis * sqrt(max(0.0, 1.0 - sy * sy));
    float lit = smoothstep(-0.06, 0.06, sx - term);
    float limb = 1.0 - smoothstep(0.86, 1.0, r);
    vec3 col = vColor * (0.28 + 0.78 * lit);
    gl_FragColor = vec4(col, limb * alpha);
    return;
  }
  // 行星：小圆盘，轻微临边昏暗
  float limb = 1.0 - smoothstep(0.72, 1.0, r);
  gl_FragColor = vec4(vColor, limb * alpha);
}
`;
