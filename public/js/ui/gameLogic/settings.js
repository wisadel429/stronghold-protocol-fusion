// ui/gameLogic/settings.js 鈥?settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { VOICE_LANGS, sanitizeVoiceOverrides } from '../../voicePrefs.js';
export { VOICE_LANGS } from '../../voicePrefs.js';

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * The operator voice dubs (settings 璇煶璇█): 'jp' 鏃ユ湰瑾?(`audio.voiceJp`, the default since 0.3.3), 'cn' 涓枃
 * (`audio.voice`), 'en' English (`audio.voiceEn`) and 'kr' 頃滉淡鞏?(`audio.voiceKr`), each falling back to the Chinese
 * line it lacks (public/js/audio.js voiceLine). Not tied to the interface language. `voiceNative` is the 鏈湡璇█
 * switch: an operator who has `audio.voiceNative` speaks that dub unless their own override says otherwise.
 * The operators whose own-language recording is a 涓枃鏂硅█ (official `voiceLangTypeDict.CN_TOPOLECT`, 20 of them) stay
 * on 涓枃 while the global is the default 鏃ユ湰瑾?鈥?voicePrefs.js voiceLangFor decides, not this table.
 */


/**
 * The steps of 璁剧疆 鈫掋€屾枃瀛楀ぇ灏忋€?(textSize): the interface text root `--t` of css/theme.css 鈥?'sm' is the design's own
 * sizes (`--t: 1rem`), the others lift the phone's 40 px root by a floor and grow the desktop gently. Text only: the
 * layout root `1rem` (and with it the field camera, the detail card's side and the DOM fallback board) never moves.
 */
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings 鈫?蹇嵎閿?. voiceLang: VOICE_LANGS, the
 *  global voice dub 鈥?鏃ユ湰瑾?by default (the owner's decision of 2026-11-02; a saved profile keeps whatever it stored).
 *  voiceNative: the 鏈湡璇█ switch (default off). textSize: TEXT_SIZES (css/theme.css `--t`, applied by ui/settings.js
 *  applyTextSize). ammoEnergyCount: 璁剧疆銆屾樉绀哄脊鑽笌鑳介噺鏁伴噺銆?鈥?the rounds left / the magazine under an ammo skill's
 *  bar and a 绉樻湳甯?s stored attack energies as stored/cap (render/units.js). One switch for the old 銆屽脊鑽暟閲忋€? *  (`ammoCount`, PR #552) and 銆岀鏈笀鑳介噺銆?(`mysticEnergy`, PR #636); off by default: the official HUD has neither
 *  number. A profile that still has either old key `true` migrates to on; those keys are not written back.
 *  [ASSUMED] a stored boolean `ammoEnergyCount` wins over the old keys, so turning the merged switch off stays off.
 *  bondTimers: selected-unit timed bond readouts (#746), off by default. [ASSUMED] Convenience HUD absent from
 *  the official game; maintainer approved 2026-10-18. Stored with the other preferences in sp.pref.settings.
 *  combatMetrics: 璁剧疆銆屼綔鎴樼粺璁°€?(PR #618), off by default: the official HUD has no such panel.
 *  prepDeployFold: 璁剧疆銆岄儴缃叉椂鏀惰捣鍟嗗簵銆?鈥?picking up a piece on the own prep board folds the shop and zooms
 *  (GitHub #602, PR #646). Default on (the 0.3.0 behaviour). Off: the pickup changes neither the shop's fold nor the
 *  camera. [ASSUMED] the label; only an explicit false turns it off (a missing or junk value stays on).
 *  officialFx: 璁剧疆銆屽畼鏂圭壒鏁堛€?(0.3.0, render/vfx): 'auto' (瀹屾暣 on a desktop, 绮剧畝 on a touch device 鈥?render/vfx/tier.js),
 *  'off', 'lite' (绮剧畝), 'full' (瀹屾暣); only shown when effects were extracted from the local client.
 *  otherSkins: 璁剧疆銆屾樉绀哄叾浠栫帺瀹剁殑鐨偆銆?(docs/SKINS.md), ON by default 鈥?draw the appearance another player chose instead
 *  of the operator's own model. A pure client preference (never sent): off, only this player's own pieces wear a skin.
 */
export const DEFAULT_SETTINGS = Object.freeze({ errorReport: true, bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'jp', voiceNative: false, voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, ammoEnergyCount: false, fullscreenWakeLock: false, bondTimers: false, combatMetrics: false, prepDeployFold: true, quality: 'high', officialFx: 'auto', otherSkins: true, textSize: 'sm', compatMode: 'auto', keys: DEFAULT_HOTKEYS });
/**
 * The values 璁剧疆銆岀敾闈㈣川閲忋€?accepts, weakest first (the dialog's display order is LOW / MEDIUM / HIGH / ULTRA /
 * EXTREME = 浣?/ 涓?/ 楂?/ 瓒呮竻 / 鏋佽嚧, ui/settings.js QUALITY). `high` is the default, so a profile stored before
 * 0.3.4 (`high` / `medium` / `low`) keeps exactly the picture it had 鈥?**no migration**; an unknown value (a profile
 * written by a newer build that this one cannot render, junk) falls back to `high` like it always did.
 *
 * A tier's id only selects the numbers in render/app/host.js (QUALITY_RES / BOARD_RES / TIER_SS / TIER_CAP_MUL);
 * the tier table alone does nothing, because render/app.js's dpr() takes the minimum with devicePixelRatio and with
 * 鏈哄瀷鍏煎's tuning.maxPixelRatio (ui/deviceTuning.js). The two new tiers cannot raise the resolution by their table
 * entry alone 鈥?they rely on TIER_SS (super-sampling, lets the ratio pass the device DPR) and TIER_CAP_MUL (raises
 * the 鏈哄瀷 cap); see host.js. Renderer-side, `setSettings` must accept every id (render/app.js setSettings) or a
 * click would be stored and then ignored.
 */
const QUALITIES = ['high', 'medium', 'low', 'ultra', 'extreme'];
/** Every value 璁剧疆銆岀敾闈㈣川閲忋€?accepts, weakest first (render/app/host.js QUALITY_IDS is the renderer's copy). */
export const QUALITY_TIERS = Object.freeze(['low', 'medium', 'high', 'ultra', 'extreme']);
/** 璁剧疆銆屾満鍨嬪吋瀹广€嶏細auto = 鎸?UA/GPU 鑷姩锛泂mooth = 寮哄埗浣庣敾璐紱hd = 寮哄埗楂樼敾璐紙ui/deviceTuning.js锛夈€?*/
export const COMPAT_MODES = Object.freeze(['auto', 'smooth', 'hd']);
/** The values of 璁剧疆銆屽畼鏂圭壒鏁堛€?(render/vfx/tier.js OFFICIAL_FX). Display order in the dialog is low / medium / high. */
export const OFFICIAL_FX_MODES = Object.freeze(['auto', 'off', 'lite', 'full']);

/**
 * The merged 鏄剧ず寮硅嵂涓庤兘閲忔暟閲?switch. A stored boolean wins. Otherwise on when either retired key was the boolean
 * true (`ammoCount` PR #552, `mysticEnergy` PR #636). Junk and a missing key stay off.
 * [ASSUMED] the new boolean wins, so a leftover old key cannot turn the switch back on.
 * @param {Record<string, any>} r
 */
function ammoEnergyCountOf(r) {
  if (typeof r.ammoEnergyCount === 'boolean') return r.ammoEnergyCount;
  return r.ammoCount === true || r.mysticEnergy === true;
}

/**
 * Sanitize persisted settings. Retired keys `ammoCount` and `mysticEnergy` are read here and never returned.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'cn'|'jp'|'en'|'kr', voiceNative: boolean, voiceOverrides: Record<string, string>, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, ammoEnergyCount: boolean, fullscreenWakeLock: boolean, bondTimers: boolean, combatMetrics: boolean, prepDeployFold: boolean, quality: 'low'|'medium'|'high'|'ultra'|'extreme', officialFx: 'auto'|'off'|'lite'|'full', otherSkins: boolean,
 *   textSize: 'sm'|'md'|'lg'|'xl', compatMode: 'auto'|'smooth'|'hd', keys: Record<'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: VOICE_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    voiceNative: r.voiceNative === true,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    ammoEnergyCount: ammoEnergyCountOf(r),
    bondTimers: r.bondTimers === true,
    combatMetrics: typeof r.combatMetrics === 'boolean' ? r.combatMetrics : DEFAULT_SETTINGS.combatMetrics,
    prepDeployFold: typeof r.prepDeployFold === 'boolean' ? r.prepDeployFold : true,
    fullscreenWakeLock: typeof r.fullscreenWakeLock === 'boolean' ? r.fullscreenWakeLock : DEFAULT_SETTINGS.fullscreenWakeLock,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    officialFx: OFFICIAL_FX_MODES.includes(r.officialFx) ? r.officialFx : DEFAULT_SETTINGS.officialFx,
    otherSkins: r.otherSkins !== false,
    textSize: TEXT_SIZES.includes(r.textSize) ? r.textSize : DEFAULT_SETTINGS.textSize,
    compatMode: COMPAT_MODES.includes(r.compatMode) ? r.compatMode : DEFAULT_SETTINGS.compatMode,
    errorReport: r.errorReport !== false,
    keys: sanitizeHotkeys(r.keys),
  };
}

