// 「全能的」可露希尔 theme — the top-right CRT ([uc]ac_s_closur panel_countdown + panel_prep_ready), drawn by ui/hud.js
// TopBar in place of the 7-segment countdown when the theme is on. The 准备就绪 toggle stays hud.js ReadyToggle (every
// rule, reason and hotkey; css/screens/ac-closure-tv.css dresses it as btn_ready / btn_cancel).
// Reference: 07-04-02, 368–371.97 s at 30 fps (original 60 fps), and 377–387 s.
// img_tv / img_tv_last are the complete lit front plates, including the CRT glass and bezel.
// The header, gear and LOADING art already contains perspective; only the flat digits / bar / chevrons rotate.
// desc_3 floats with a two-second period; its right face catches light, with two smaller cubes above/below.
// State behavior: live clock -> amber at 10 s; SETTLE / ready -> chevrons; no clock -> gear;
// ROUND_START fades out, then the gear boots briefly before the next clock.
// 倒计时 (CN_018 「喂？博士，醒醒，看看时间！」) when 休整期's clock reaches 10 s (user, 2026-11-10) — not once ready.

import { html, useTicker, secondsLeft, hasDeadline } from '/js/ui/components.js';
import { useEffect, useRef, useState } from '/vendor/hooks.module.js';
import { PHASE } from '/shared/constants.js';
import { isCombatPhase } from '/js/ui/gameLogic.js';
import { t } from '/shared/i18n.js';
import { closureVo } from '/js/ui/acClosureVoice.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// The screens' sprites are CSS backgrounds, fetched the first time a screen shows — the seconds or ▶▶ would come up
// blank for a beat (a fresh 休整期 / 结算): fetch them when this theme mounts.
const IMG = new URL('/ui-art/img/official/hub/ac/theme/almighty_closure/', location.origin).href;
let artPreloaded = false;
function preloadTvArt() {
  if (artPreloaded || typeof Image === 'undefined') return;
  artPreloaded = true;
  for (const f of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'img_tv_desc', 'img_tv_single', 'ready_arrow', 'ready_arrow_mask', 'ready_continue', 'desc_3', 'desc_3_light', 'tv_cube_small', 'tv_cube_lower', 'img_tv', 'img_tv_last']) {
    new Image().src = `${IMG}${f}.png`;
  }
}

/** ▶▶ at the start of a battle (footage 96.3–97.9 s, then the glass dims once and the seconds come up). */
const GO_MS = 1500;
const WARN_AT = 10;

/** The set stays away while these show (the round popup has the screen). */
const HIDDEN_PHASES = new Set([PHASE.ROUND_START]);
/** The gear between the fade-in and the seconds (footage 387.0 → 387.25 s). */
const BOOT_MS = 260;

/** Which screen the CRT shows (pure): 'hidden' | 'gear' | 'ready' | 'count'. */
export function tvMode({ phase, remain, ready = false, go = false, boot = false }) {
  if (HIDDEN_PHASES.has(phase)) return 'hidden';
  if (go || phase === PHASE.SETTLE) return 'ready';
  if (boot) return 'gear';
  // ready and waiting: ▶▶ LOADING — but the last seconds still show (as for everyone else)
  if (phase === PHASE.PREP && ready && (remain == null || remain > WARN_AT)) return 'ready';
  if (remain == null) return 'gear';
  return 'count';
}

function Digits({ n }) {
  const s = String(Math.min(999, Math.max(0, n))).padStart(2, '0');
  return html`<span class="ctv__num" aria-hidden="true">${[...s].map((d, i) => html`<i key=${i} class=${`ctv__d ctv__d--${d}`}></i>`)}</span>`;
}

export function ClosureTv({ phase, deadline, total, frozenSecs = null, ready = false }) {
  useEffect(preloadTvArt, []);
  const live = frozenSecs == null && hasDeadline(deadline);
  useTicker(live ? 200 : 0);
  const remain = frozenSecs != null && Number.isFinite(Number(frozenSecs)) ? Math.max(0, Math.floor(Number(frozenSecs))) : live ? secondsLeft(deadline) : null;
  const combat = isCombatPhase(phase);
  const prevCombat = useRef(combat);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const was = prevCombat.current;
    prevCombat.current = combat;
    if (!combat || was) return undefined;
    setGo(true);
    const id = setTimeout(() => setGo(false), GO_MS);
    return () => clearTimeout(id);
  }, [combat]);
  const hidden = HIDDEN_PHASES.has(phase);
  const wasHidden = useRef(hidden);
  const [boot, setBoot] = useState(false);
  useEffect(() => {
    const was = wasHidden.current;
    wasHidden.current = hidden;
    if (hidden || !was) return undefined;
    setBoot(true);
    const id = setTimeout(() => setBoot(false), BOOT_MS);
    return () => clearTimeout(id);
  }, [hidden]);
  const mode = tvMode({ phase, remain, ready, go, boot });
  const warn = mode === 'count' && remain <= WARN_AT;
  // the line as 休整期 crosses into its last WARN_AT seconds (a running clock only: not a paused / frozen one)
  const prevRemain = useRef(remain);
  useEffect(() => {
    const was = prevRemain.current;
    prevRemain.current = remain;
    if (live && phase === PHASE.PREP && !ready && remain != null && remain > 0 && remain <= WARN_AT && was != null && was > WARN_AT) closureVo('countdown');
  }, [remain]);
  const frac = Number.isFinite(total) && total > 0 && remain != null ? Math.max(0, Math.min(1, remain / total)) : 1;
  // hidden: keep the last screen under the fade-out (footage 381.5 s: ▶▶ fading with the set)
  const lastShown = useRef('gear');
  if (mode !== 'hidden') lastShown.current = mode;
  const shown = lastShown.current;
  return html`<div class=${cx('ctv', `is-${shown}`, warn && 'is-warn', mode === 'hidden' && 'is-away')} role="timer" data-testid="closure-tv"
      aria-hidden=${mode === 'hidden' ? 'true' : null}
      aria-label=${remain == null ? t('无倒计时') : t('剩余{remain}秒', { remain })}>
    <i class="ctv__back"></i>
    <i class="ctv__dots"></i>
    <i class="ctv__small"></i>
    <i class="ctv__lower"></i>
    <div class="ctv__cube"><i class="ctv__cube-light"></i></div>
    <i class="ctv__body"></i>
    <i class="ctv__front"></i>
    <div class="ctv__screen"><div class="ctv__glass">
      <div class="ctv__in" key=${shown}>
        ${shown === 'gear' ? html`<i class="ctv__gear"></i>` : null}
        ${shown === 'ready' ? html`<i class="ctv__load"></i><i class="ctv__arrow"></i>` : null}
        ${shown === 'count' ? html`<i class="ctv__desc"></i><${Digits} n=${remain} />
          <span class="ctv__bar"><i style=${`--f:${frac.toFixed(3)}`}></i></span>` : null}
      </div>
    </div></div>
    <i class="ctv__star ctv__star--a"></i><i class="ctv__star ctv__star--b"></i><i class="ctv__star ctv__star--c"></i><i class="ctv__star ctv__star--d"></i>
  </div>`;
}
