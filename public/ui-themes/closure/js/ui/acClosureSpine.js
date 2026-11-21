// 「全能的」可露希尔 theme — the theme's Spine figure (ac_s_closur_spine, Spine 3.8: Closure and her three pets, Idle /
// Happy / Interact / Talk / Special_A·B / Sad_*), drawn on its own transparent canvas. Used by the shop's room
// (acClosureShop.js) and the round-start window (acClosureRound.js).
//   box  — the canvas's size in design px (the CSS gives it that size; the skeleton follows the canvas's real width)
//   fig  — design px per skeleton unit and the skeleton origin (her feet) from the box's top-left
//   anim — the looping clip; cue {n, name} plays `name` once, then back to `anim`
//   bg   — scale of the skeleton's BG bone (the pets, the floor, the star; no clip keys it): the round-start window
//          has them closer to her and smaller than the shop's room (footage: × 0.82)

import { html } from '/js/ui/components.js';
import { useEffect, useRef } from '/vendor/hooks.module.js';
import { ensurePixi } from '/js/render/app/pixi.js';

const SKEL = new URL('/ui-art/img/official/hub/ac/theme/almighty_closure/spine/ac_s_closur_spine.json', location.origin).href;

let spineReady;
export function preloadClosureSpine() {
  if (!spineReady) spineReady = ensurePixi().then(async (PIXI) => ({ PIXI, res: await PIXI.Assets.load(SKEL) }));
  return spineReady;
}

export function ClosureSpine({ cls, box, fig, anim = 'Idle', cue = null, bg = 1, onReady = null }) {
  const ref = useRef(null);
  const spRef = useRef(null);
  useEffect(() => {
    let dead = false;
    let app = null;
    let ro = null;
    (async () => {
      const { PIXI, res } = await preloadClosureSpine();
      const cv = ref.current;
      if (dead || !cv) return;
      const data = (res && res.spineData) || res;
      app = new PIXI.Application({ view: cv, backgroundAlpha: 0, antialias: true, width: 1, height: 1 });
      const sp = new PIXI.spine.Spine(data);
      try { sp.state.setAnimation(0, anim, true); } catch { sp.state.setAnimation(0, 'Idle', true); }
      if (bg !== 1) {
        const b = sp.skeleton.findBone('BG');
        if (b) { b.scaleX = bg; b.scaleY = bg; }
      }
      app.stage.addChild(sp);
      spRef.current = sp;
      const fit = () => {
        const dpr = globalThis.devicePixelRatio || 1;
        const cw = cv.clientWidth || 1;
        const ch = cv.clientHeight || 1;
        app.renderer.resize(Math.max(1, Math.round(cw * dpr)), Math.max(1, Math.round(ch * dpr)));
        const u = (cw / box[0]) * dpr; // device px per design px
        sp.scale.set(fig.scale * u);
        sp.position.set(fig.x * u, fig.y * u);
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(cv);
      onReady?.();
    })().catch((e) => { console.warn('[closure spine]', e && e.message ? e.message : e); if (!dead) onReady?.(); });
    return () => {
      dead = true;
      spRef.current = null;
      if (ro) ro.disconnect();
      if (app) app.destroy(false, { children: true });
    };
  }, []);
  useEffect(() => {
    const sp = spRef.current;
    if (!sp || !cue?.n) return;
    try {
      sp.state.setAnimation(0, cue.name, false);
      sp.state.addAnimation(0, anim, true, 0);
    } catch { /* a clip the skeleton lacks: stay in the loop */ }
  }, [cue?.n]);
  return html`<canvas class=${cls} ref=${ref} aria-hidden="true"></canvas>`;
}
