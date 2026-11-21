// render/vfx/post.js — the official effects layer's HDR accumulation and bloom (方案 B): the fx layers draw into an
// RGBA16F render target of their own instead of straight onto the 8-bit Pixi canvas, a real multi-pass bloom is built
// from that target, and the target is composited back at the layer's own place in the frame.
//
//   const post = new FxPost(gl)
//   post.setLevel(0 | 1 | 2)     0 = off (the old direct path, no render target at all), 1 = single-level bloom,
//                                2 = two-level (a second downsample before the blur)
//   post.begin() → bool          bind the HDR target for ONE fx pass and clear it (false: nothing usable, draw direct)
//   post.end(bloom)              bloom chain + composite back onto whatever framebuffer was bound before
//   post.destroy()
//
// Why an own target and not the scene's: the fx layer is TWO passes around the units (render/app.js: vfxGround under,
// vfxOver above, system.js renderPass), so a single full-frame post-process would have to run either before the units
// (dragging the over pass under them) or after them (blooming the units, the bars and the text). One target reused by
// both passes keeps the layer where it is, and keeps the board (another WebGL context under the transparent canvas),
// the units and the whole UI structurally outside the bloom.
//
// HDR: the materials of the official effects are authored with colours above 1 (149 of the 10 270 extracted prefabs
// carry a material with max(rgb) × alpha > 1, up to 10×; handoff/fx-hdr-bloom/alpha-scan.json). An RGBA8 canvas clamps
// every one of those adds at 1.0, and drops the sub-1/255 steps of the faint alpha layers entirely; RGBA16F keeps both,
// and gives the bloom a bright pass that can tell a 1.0 pixel from a 4× one.
//
// Compositing: the target holds exactly what the canvas held before (premultiplied colour + coverage alpha, see the
// header of render/vfx/gl.js), so the composite is `blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA)` on rgb AND alpha: a
// pixel the effects never touched keeps the framebuffer bit for bit. The bloom is added on top as light (it raises rgb
// without raising alpha) — that is what lifts a faint layer off a bright board instead of blending it into it.

/** Bloom constants (the 依据 of each one is in handoff/fx-hdr-bloom/REPORT.md §1.2 / §3; the target's measured
 *  luminance distribution is handoff/fx-hdr-bloom/hdr-probe.json). */
export const POST = Object.freeze({
  /** Luminance a premultiplied fx pixel needs before it starts to glow. Measured: the S3 trail's covered pixels are
   *  P50 0.054 / P90 0.52 / max 2.49 — 0.28 lets its bright half glow while sparse dust stays dark. */
  threshold: 0.28,
  /** Soft knee of that threshold: full weight at threshold + knee, none at threshold − knee. */
  knee: 0.16,
  /** Weight of the blurred light added back in the composite. 0.55, chosen by eye + pixels against 0.9 (at 0.9 an
   *  explosion's core washed out to a white disc: 1283 new pure-white px in dark-oxi-hit). */
  strength: 0.55,
  /** Blur step in destination texels (the blur runs at 1/4 resolution: 1.0 ≈ a 16 full-res-pixel halo radius). */
  blurRadius: 1.25,
  /** Bloom on the ground pass? The ground pass is flat decals / range markers under the units; a glow there reads as a
   *  brighter board, not as a lit effect. Off by default; the over pass (particles) is where the light is. */
  ground: false,
});

const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

/** Fullscreen triangle: no attributes (gl_VertexID), so no vertex buffer is needed — an empty VAO is enough. */
const FS_VS = `${HEAD}
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Bright pass + 2× downsample: a 4-tap box average, then a soft-knee threshold on its luminance. */
const BRIGHT_FS = `${HEAD}
uniform sampler2D u_src;
uniform vec2 u_srcTexel;   // 1 / source size
uniform vec2 u_dstSize;    // destination size (device px)
uniform float u_threshold;
uniform float u_knee;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_dstSize;
  vec3 c = 0.25 * (
      texture(u_src, uv + vec2(-1.0, -1.0) * u_srcTexel).rgb
    + texture(u_src, uv + vec2( 1.0, -1.0) * u_srcTexel).rgb
    + texture(u_src, uv + vec2(-1.0,  1.0) * u_srcTexel).rgb
    + texture(u_src, uv + vec2( 1.0,  1.0) * u_srcTexel).rgb);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(u_threshold - u_knee, u_threshold + u_knee, lum);
  o = vec4(c * w, 1.0);
}`;

/** Plain 2× downsample (the second level). */
const DOWN_FS = `${HEAD}
uniform sampler2D u_src;
uniform vec2 u_srcTexel;
uniform vec2 u_dstSize;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_dstSize;
  o = vec4(0.25 * (
      texture(u_src, uv + vec2(-1.0, -1.0) * u_srcTexel).rgb
    + texture(u_src, uv + vec2( 1.0, -1.0) * u_srcTexel).rgb
    + texture(u_src, uv + vec2(-1.0,  1.0) * u_srcTexel).rgb
    + texture(u_src, uv + vec2( 1.0,  1.0) * u_srcTexel).rgb), 1.0);
}`;

/** Separable 9-tap gaussian (σ ≈ 1.75 texels of the destination), one axis per pass. */
const BLUR_FS = `${HEAD}
uniform sampler2D u_src;
uniform vec2 u_step;       // direction × radius × 1/size
uniform vec2 u_dstSize;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_dstSize;
  // weights of a 9-tap gaussian (σ 1.75), normalised
  const float w0 = 0.2301, w1 = 0.1954, w2 = 0.1197, w3 = 0.0534, w4 = 0.0169;
  vec3 c = texture(u_src, uv).rgb * w0;
  c += (texture(u_src, uv + u_step * 1.0).rgb + texture(u_src, uv - u_step * 1.0).rgb) * w1;
  c += (texture(u_src, uv + u_step * 2.0).rgb + texture(u_src, uv - u_step * 2.0).rgb) * w2;
  c += (texture(u_src, uv + u_step * 3.0).rgb + texture(u_src, uv - u_step * 3.0).rgb) * w3;
  c += (texture(u_src, uv + u_step * 4.0).rgb + texture(u_src, uv - u_step * 4.0).rgb) * w4;
  o = vec4(c, 1.0);
}`;

/** The composite: the HDR target clamped to the display range (bit-identical to the old 8-bit path) plus the bloom. */
const COMPOSITE_FS = `${HEAD}
uniform sampler2D u_hdr;
uniform sampler2D u_bloom;
uniform vec2 u_size;       // the framebuffer size (device px)
uniform float u_strength;
uniform float u_bloomOn;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec4 h = texture(u_hdr, uv);
  vec3 c = min(h.rgb, vec3(1.0));                       // the old canvas clamp, unchanged
  c += texture(u_bloom, uv).rgb * (u_strength * u_bloomOn);
  o = vec4(c, h.a);                                     // alpha = the layer's coverage, unchanged
}`;

/** HDR render target: RGBA16F colour + a depth buffer for the ZTest materials' board heightfield pre-pass. */
export class FxPost {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl;
    this.level = 0;              // requested level (0 off, 1, 2)
    this.available = true;       // false once the driver refused a half-float target
    this.w = 0; this.h = 0;
    this.rt = null;
    this.half = null;            // 1/2: bright pass
    this.quarter = null;         // 1/4: blur A
    this.quarter2 = null;        // 1/4: blur B
    this.progs = null;
    this.vao = null;
    this.stats = { ms: 0, passes: 0, level: 0, rtMB: 0, width: 0, height: 0, reason: '' };
    this._prev = null;
    this._supported = null;      // null = not probed yet
  }

  /** The level in force: 0 when off, unsupported, or the target could not be built. */
  get active() { return this.level > 0 && this.available && !!this.rt; }

  /** 0 | 1 | 2. Builds / drops the targets as asked (idempotent). */
  setLevel(n) {
    const lv = n === 1 || n === 2 ? n : 0;
    if (lv === this.level) return this.level;
    this.level = lv;
    this.stats.level = lv;
    if (lv > 0 && this._supported !== false) this._ensure();
    if (lv === 0) this._drop();
    return this.level;
  }

  /** Is RGBA16F renderable here? (probed once, with a 4×4 target, so a refusal costs nothing later) */
  _probe() {
    if (this._supported !== null) return this._supported;
    const gl = this.gl;
    let ok;
    try { ok = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')); } catch { ok = false; }
    if (ok) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
    }
    this._supported = ok;
    if (!ok) { this.available = false; this.stats.reason = 'no RGBA16F render target'; console.warn('[fx] HDR target unsupported: the effects draw straight onto the canvas'); }
    return ok;
  }

  _initProgs() {
    if (this.progs) return true;
    const gl = this.gl;
    try {
      this.progs = {
        bright: this._link(FS_VS, BRIGHT_FS),
        down: this._link(FS_VS, DOWN_FS),
        blur: this._link(FS_VS, BLUR_FS),
        composite: this._link(FS_VS, COMPOSITE_FS),
      };
      this.vao = gl.createVertexArray();
      this.u = {
        bright: this._uniforms(this.progs.bright, ['u_src', 'u_srcTexel', 'u_dstSize', 'u_threshold', 'u_knee']),
        down: this._uniforms(this.progs.down, ['u_src', 'u_srcTexel', 'u_dstSize']),
        blur: this._uniforms(this.progs.blur, ['u_src', 'u_step', 'u_dstSize']),
        composite: this._uniforms(this.progs.composite, ['u_hdr', 'u_bloom', 'u_size', 'u_strength', 'u_bloomOn']),
      };
      return true;
    } catch (err) {
      console.warn('[fx] bloom programs failed', err?.message || err);
      this.available = false;
      this.stats.reason = String(err?.message || err);
      return false;
    }
  }

  _link(vs, fs) {
    const gl = this.gl;
    const sh = (t, src) => {
      const s = gl.createShader(t);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`fx post: ${log}`); }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(`fx post program: ${log}`); }
    return p;
  }

  _uniforms(prog, names) {
    const out = {};
    for (const n of names) out[n] = this.gl.getUniformLocation(prog, n);
    return out;
  }

  /** Build (or rebuild) the targets for the current drawing buffer. */
  _ensure() {
    const gl = this.gl;
    if (!this._probe() || !this._initProgs()) { this._drop(); return; }
    const w = Math.max(1, gl.drawingBufferWidth | 0), h = Math.max(1, gl.drawingBufferHeight | 0);
    if (this.rt && this.w === w && this.h === h) return;
    this._drop();
    this.w = w; this.h = h;
    const make = (tw, th, depth) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let rb = null;
      if (depth) {
        rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, tw, th);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); if (rb) gl.deleteRenderbuffer(rb); return null; }
      return { fbo, tex, rb, w: tw, h: th };
    };
    this.rt = make(w, h, true);
    this.half = make(Math.max(1, w >> 1), Math.max(1, h >> 1), false);
    this.quarter = make(Math.max(1, w >> 2), Math.max(1, h >> 2), false);
    this.quarter2 = make(Math.max(1, w >> 2), Math.max(1, h >> 2), false);
    if (!this.rt || !this.half || !this.quarter || !this.quarter2) {
      console.warn('[fx] HDR target incomplete: the effects draw straight onto the canvas');
      this._drop();
      this.available = false;
      this.stats.reason = 'incomplete framebuffer';
      return;
    }
    const px = (t) => t.w * t.h * 8;
    this.stats.width = w; this.stats.height = h;
    this.stats.rtMB = Math.round((px(this.rt) + w * h * 2 + px(this.half) + px(this.quarter) + px(this.quarter2)) / 1048576 * 10) / 10;
  }

  _drop() {
    const gl = this.gl;
    for (const t of [this.rt, this.half, this.quarter, this.quarter2]) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
      if (t.rb) gl.deleteRenderbuffer(t.rb);
    }
    this.rt = this.half = this.quarter = this.quarter2 = null;
    this.w = this.h = 0;
  }

  /**
   * Bind the HDR target for one fx pass and clear it. False = draw straight onto the canvas (off / unsupported / a
   * target that could not be resized); the caller must then not call end().
   */
  begin() {
    if (!this.active) return false;
    const gl = this.gl;
    const w = Math.max(1, gl.drawingBufferWidth | 0), h = Math.max(1, gl.drawingBufferHeight | 0);
    if (w !== this.w || h !== this.h) { this._ensure(); if (!this.active) return false; }
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vp = gl.getParameter(gl.VIEWPORT);
    this._prev = { fb, vp: [vp[0], vp[1], vp[2], vp[3]], scissor: gl.isEnabled(gl.SCISSOR_TEST) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rt.fbo);
    gl.viewport(0, 0, this.w, this.h);
    if (this._prev.scissor) gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._t0 = performance.now();
    return true;
  }

  /** Bloom from the target, composite it back in place, restore the caller's GL state. */
  end(bloom = true) {
    const gl = this.gl;
    const prev = this._prev;
    this._prev = null;
    if (!prev || !this.active) return;
    const t0 = this._t0;
    const u = this.u;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    // 1. bright pass: the full target → 1/2
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.half.fbo);
    gl.viewport(0, 0, this.half.w, this.half.h);
    gl.useProgram(this.progs.bright);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rt.tex); gl.uniform1i(u.bright.u_src, 0);
    gl.uniform2f(u.bright.u_srcTexel, 1 / this.w, 1 / this.h);
    gl.uniform2f(u.bright.u_dstSize, this.half.w, this.half.h);
    gl.uniform1f(u.bright.u_threshold, POST.threshold);
    gl.uniform1f(u.bright.u_knee, POST.knee);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. (level 2) 1/2 → 1/4 makes the halo wider and cheaper than a bigger blur at 1/2; level 1 blurs the 1/2 target
    //    straight away (quarter2 is the scratch pad in both cases)
    let src = this.half;
    if (this.level >= 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.quarter.fbo);
      gl.viewport(0, 0, this.quarter.w, this.quarter.h);
      gl.useProgram(this.progs.down);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.half.tex); gl.uniform1i(u.down.u_src, 0);
      gl.uniform2f(u.down.u_srcTexel, 1 / this.half.w, 1 / this.half.h);
      gl.uniform2f(u.down.u_dstSize, this.quarter.w, this.quarter.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = this.quarter;
    }
    // 3. separable blur: horizontal src → quarter2, vertical quarter2 → quarter (the texture the composite reads)
    const sx = POST.blurRadius / src.w, sy = POST.blurRadius / src.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.quarter2.fbo);
    gl.viewport(0, 0, this.quarter2.w, this.quarter2.h);
    gl.useProgram(this.progs.blur);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(u.blur.u_src, 0);
    gl.uniform2f(u.blur.u_step, sx, 0);
    gl.uniform2f(u.blur.u_dstSize, this.quarter2.w, this.quarter2.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.quarter.fbo);
    gl.viewport(0, 0, this.quarter.w, this.quarter.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.quarter2.tex);
    gl.uniform2f(u.blur.u_step, 0, sy);
    gl.uniform2f(u.blur.u_dstSize, this.quarter.w, this.quarter.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 4. composite back where the pass was drawing (rgb and alpha both "over", so untouched pixels stay untouched)
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fb);
    gl.viewport(prev.vp[0], prev.vp[1], prev.vp[2], prev.vp[3]);
    gl.useProgram(this.progs.composite);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rt.tex); gl.uniform1i(u.composite.u_hdr, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.quarter.tex); gl.uniform1i(u.composite.u_bloom, 1);
    gl.uniform2f(u.composite.u_size, this.w, this.h);
    gl.uniform1f(u.composite.u_strength, POST.strength);
    gl.uniform1f(u.composite.u_bloomOn, bloom ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    if (prev.scissor) gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    const ms = performance.now() - t0;
    this.stats.ms = this.stats.ms * 0.9 + ms * 0.1;
    this.stats.passes++;
  }

  destroy() {
    this._drop();
    const gl = this.gl;
    if (this.progs) for (const p of Object.values(this.progs)) gl.deleteProgram(p);
    this.progs = null;
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = null;
    this.level = 0;
  }
}

/** The URL override of the bloom level (`?fxpost=0|1|2`, `?fxpost=off`); null when the URL does not say. */
export function postFromQuery(search) {
  try {
    const v = new URLSearchParams(search || '').get('fxpost');
    if (v == null || v === '') return null;
    if (/^(off|0|false|no)$/i.test(v)) return 0;
    if (v === '1' || /^lite$/i.test(v)) return 1;
    if (v === '2' || /^(full|on)$/i.test(v)) return 2;
  } catch { /* no URLSearchParams (tests) */ }
  return null;
}
