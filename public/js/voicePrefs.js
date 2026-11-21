// Browser-local dub preferences. Every variant of an operator shares its charId; absent entries follow the global dub.
// Global settings.voiceLang is one of VOICE_LANGS and is 日本語 by default (0.3.3; a saved profile keeps its own pick).
// A per-operator override may also be 'native' (the operator's own-language dub, audio.voiceNative). audio.js
// re-exports VOICE_TREES and plays the tree voiceLangFor picks.

export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr']);
/** Values a per-operator override may store. 'native' is not a global voiceLang. */
export const VOICE_PICKS = Object.freeze([...VOICE_LANGS, 'native']);
/** Manifest tree of each non-Chinese dub. Chinese is audio.voice. */
export const VOICE_TREES = Object.freeze({ jp: 'voiceJp', en: 'voiceEn', kr: 'voiceKr', native: 'voiceNative' });
/** Manifest tree of each dub's **skin-exclusive** lines, keyed by the skin's voice word key (`skinId.replace('@','_')`).
 * A skin that carries its own dub speaks it for as long as it is worn (audio.js voiceLine → data/skin-voices.json). */
export const SKIN_TREES = Object.freeze({ cn: 'skinVoice', jp: 'skinVoiceJp', en: 'skinVoiceEn', kr: 'skinVoiceKr' });

const TREE = Object.freeze({ cn: 'voice', ...VOICE_TREES });

export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, lang] of Object.entries(raw).slice(0, 512)) {
    if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && id.length <= 80 && VOICE_PICKS.includes(lang)) out[id] = lang;
  }
  return out;
}

/** This server's manifest lists at least one line of `charId` in `lang`. */
function hasTree(audio, charId, lang) {
  return !!slotsOf(audio, charId, lang);
}

/** The slots of `charId` in `lang`'s tree (`audio.voice` for 中文), or null when it has no line there. */
function slotsOf(audio, charId, lang) {
  const slots = audio?.[TREE[lang]]?.[charId];
  return slots && typeof slots === 'object' && !Array.isArray(slots) && Object.keys(slots).length > 0 ? slots : null;
}

/**
 * The one dub this server has for `charId` at all — 中文 first, then 日本語 / English / 한국어 / 本土语言 — or null when it
 * has none (the 预备干员 / 原型干员 stand-ins, 盟约·辅助干员, summons).
 * @param {any} audio the manifest's `audio`
 * @param {string} charId
 * @returns {'cn'|'jp'|'en'|'kr'|'native'|null}
 */
export function onlyDub(audio, charId) {
  for (const lang of VOICE_LANGS) if (hasTree(audio, charId, lang)) return lang;
  return hasTree(audio, charId, 'native') ? 'native' : null;
}

/**
 * The slots a caller reads for `charId` when the dub that will play is `lang`: that tree when this server has it, else the
 * Chinese one, else the only tree it has at all. A 联动 (LINKAGE) operator has no `audio.voice` entry — its lines live in
 * `audio.voiceJp` — so a reader that looked only at the Chinese tree found nothing (the 试听 button was dead for 結城理 /
 * 丰川祥子). The slots keep the file names of their own tree; nothing is copied between the trees.
 * @param {any} audio the manifest's `audio`
 * @param {string} charId
 * @param {'cn'|'jp'|'en'|'kr'|'native'|string} lang
 * @returns {Record<string, string|string[]>|null}
 */
export function voiceSlotsOf(audio, charId, lang) {
  for (const dub of [lang, ...VOICE_LANGS.filter((l) => l !== lang), 'native']) {
    const slots = slotsOf(audio, charId, dub);
    if (slots) return slots;
  }
  return null;
}

/**
 * The operator's own-language recording is a 中文方言 — the official `voiceLangTypeDict` groupType `CN_TOPOLECT`
 * (粤语 / 吴语 / 闽南语 …: 陈 / 令 / 年 / 夕 / 黍 / 重岳 等 20 名). Its `audio.voiceNative` line is a Chinese one.
 * @param {any} audio the manifest's `audio`
 * @param {string} charId
 * @returns {boolean}
 */
function chineseDialectDub(audio, charId) {
  return audio?.voiceNativeLangType?.[charId] === 'CN_TOPOLECT';
}

/**
 * The dub `charId` speaks.
 * Without `opts.audio` (tests and callers from before the extra dubs) the 0.2.3 rule stands: an own 'cn' or 'jp'
 * wins, otherwise the global language is 'jp' or 'cn'. 'en' / 'kr' / 'native' are not applied on that path.
 * With `audio` (including an empty object): the operator's own choice when this server has that tree, else the
 * own-language dub when `opts.native` is on and the operator has one, else 中文 for an operator whose own-language
 * recording is a 中文方言 while the global is the default 日本語 (chineseDialectDub), else the global language when that
 * tree is present, else the only dub this server has for the operator (onlyDub — a 联动 operator's LINKAGE dub, which is
 * the Japanese tree and the operator's only official recording), else 'cn'.
 * @param {string} charId
 * @param {string} globalLang
 * @param {Record<string, string>|null|undefined} overrides
 * @param {{ native?: boolean, audio?: any }|null} [opts]
 * @returns {'cn'|'jp'|'en'|'kr'|'native'}
 */
export function voiceLangFor(charId, globalLang, overrides, opts) {
  const own = Object.hasOwn(overrides || {}, charId) ? overrides[charId] : null;
  const audio = opts?.audio;
  if (audio == null) return (own === 'cn' || own === 'jp') ? own : globalLang === 'jp' ? 'jp' : 'cn';
  if (VOICE_PICKS.includes(own) && hasTree(audio, charId, own)) return own;
  if (opts.native === true && hasTree(audio, charId, 'native')) return 'native';
  const global = VOICE_LANGS.includes(globalLang) ? globalLang : 'cn';
  // 默认语音语言 is 日本語 (DEFAULT_SETTINGS.voiceLang, the owner's decision of 2026-11-02). The operators whose own
  // official recording is a 中文方言 (voiceLangTypeDict CN_TOPOLECT — 粤语 / 吴语 / 闽南语 …) default to 中文 instead: the
  // voice recorded for them is a Chinese one, and the dialect itself stays one 本土语言 switch away. An explicit
  // per-operator pick still wins above; an explicitly chosen English / Korean global follows that global.
  if (global === 'jp' && chineseDialectDub(audio, charId) && hasTree(audio, charId, 'cn')) return 'cn';
  if (hasTree(audio, charId, global)) return global;
  // 联动 (LINKAGE) operators — 結城理 char_4217_makoto, 丰川祥子 char_4182_oblvns and the rest of the collab cast — were
  // recorded in ONE dub: charword `voiceLangDict` lists LINKAGE alone, the manifest files it under `audio.voiceJp`, and
  // the Chinese tree has no entry at all. 中文 is therefore not a fallback they have; falling back to it left them mute in
  // every phase (no 选中干员 when a card of theirs was tapped). The dub they were actually recorded in is what plays — the
  // file is the operator's own official line, never a copy of another tree (red line: no fake 中配).
  const only = onlyDub(audio, charId);
  return only ?? 'cn';
}
