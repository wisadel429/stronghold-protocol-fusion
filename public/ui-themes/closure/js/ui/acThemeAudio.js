/**
 * Bridge: expose theme SE/VO through window + optional AudioBus hook.
 * Does not replace core audio.js; installs click/phase hooks that fire when
 * data-ac-terminal-theme matches. Self-check: window.__AC_THEME_AUDIO__.selfCheck()
 */
function themeId() {
  return document.documentElement.getAttribute('data-ac-terminal-theme') || '';
}

async function ensureMods() {
  const id = themeId();
  if (id === 'ac_s_closur') {
    const m = await import('/js/ui/acClosureVoice.js');
    return { play: m.playClosureVo, map: m.CLOSURE_VO_MAP, kind: 'closure-vo' };
  }
  if (id === 'ac_n_iron') {
    const m = await import('/js/ui/acUrsusSe.js');
    return { play: m.playUrsusSe, map: m.URSUS_SE_MAP, kind: 'ursus-se' };
  }
  return null;
}

export async function playThemeCue(event) {
  const mods = await ensureMods();
  if (!mods) return null;
  return mods.play(event);
}

export async function selfCheck() {
  const id = themeId();
  const mods = await ensureMods();
  const out = { theme: id, ok: false, kind: null, mapKeys: [], sampleUrl: null, error: null };
  if (!mods) { out.error = 'no theme audio module for ' + id; return out; }
  out.kind = mods.kind;
  out.mapKeys = Object.keys(mods.map || {});
  const sample = mods.map.enter || mods.map.refresh || out.mapKeys[0];
  out.sampleUrl = sample ? `/ui-art/audio/theme/${id}/${sample}.wav` : null;
  try {
    if (out.sampleUrl) {
      const r = await fetch(out.sampleUrl, { method: 'HEAD', cache: 'no-store' });
      out.ok = r.ok;
      out.status = r.status;
    }
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  return out;
}

export function installThemeAudioBridge() {
  if (typeof window === 'undefined') return;
  window.__AC_THEME_AUDIO__ = { play: playThemeCue, selfCheck };
  // Optional: if game AudioBus exposes uiClick, wrap once
  try {
    const bus = window.AudioBus || window.audio || null;
    if (bus && typeof bus.playUi === 'function' && !bus.__acThemeWrapped) {
      const orig = bus.playUi.bind(bus);
      bus.playUi = function (name, ...rest) {
        playThemeCue(name).catch(() => {});
        return orig(name, ...rest);
      };
      bus.__acThemeWrapped = true;
    }
  } catch {}
}

if (typeof document !== 'undefined') {
  const boot = () => installThemeAudioBridge();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
