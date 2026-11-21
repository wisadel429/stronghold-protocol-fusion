// 卫戍协议：盟约 主界面 — the official event lobby, rebuilt from the owner's recording (2026-10-27, 0:03–1:20 and 0:30–0:36):
// the top bar (返回 / 首页, 玩法说明, the 关键目标 medal, the 防卫目标 refresh clock), 成就统计 at the top left, 报酬说明 ·
// 每日防卫目标 · 关键目标 · 功勋兑换处 down the left, S.W.E.E.P.报告 · 物资调配处 · 模拟邀约 on the right and the
// 独立模拟 / 同盟模拟 groups at the bottom right. Every picture is the event's own sprite (static/img/official/hub, kept
// out of /assets/ so the resource worker never answers for it); the captions the sprites carried in Traditional Chinese
// were erased and are drawn here. Positions are the recording's pixels (1280×720) in `--p` units (css/screens/
// hub-official.css), anchored to the edge they sit on in the recording.
// The figures are this account's own: 卫戍认证 (each settled match's `reward`, screens/settle.js levelOf → LV), today's
// 每日防卫目标 points (config.rewards.baseByRoundsPassed, the day turning at 04:00), the 关键目标 below (counted from the
// match records, claimed marks kept on this device), the reward formula of 报酬说明 (config.rewards).
import { useEffect, useMemo, useRef, useState } from '/vendor/hooks.module.js';
import { html, Icon } from '/js/ui/components.js';
import { useData, getConfig } from '/js/data.js';
import { loadPref, savePref } from '/js/store.js';
import { useRecords } from '/js/ui/cloudStats.js';
import { TrophyBadge } from '/js/ui/trophies.js';
import { selfRowOf, roundsOf, countsTowardStats, isModdedRecord, highestBondRecord } from '/js/ui/stats.js';
import { levelOf, dayKey, dailyPointsFor, LV_MAX, LV_EXP } from '/js/screens/settle.js';
import { openGuide } from '/js/ui/guide.js';
import { toast } from '/js/ui/toasts.js';
import { DIFFICULTIES, DIFFICULTY_NAMES } from '/shared/constants.js';
import { t } from '/shared/i18n.js';

export const ART = new URL('/ui-art/img/official/hub/', location.origin).href;
const cx = (...p) => p.flat().filter(Boolean).join(' ');
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const DIFF_ICON = { FUNNY: 'img_diff_funny', NORMAL: 'img_diff_normal', HARD: 'img_diff_hard', ABYSS: 'img_diff_abyss' };

// ---- the account's progress ------------------------------------------------------------------------------------------

/**
 * 关键目标 (the recording 0:31–0:36): the event's task list, counted from the match records. `need` / `of(stats)`;
 * `reward` is the 卫戍认证 the official task shows.
 */
export const KEY_GOALS = [
  { id: 'clear10', text: N('活动期间，累计通关任意模拟10次'), need: 10, reward: 400, of: (s) => s.clears },
  { id: 'bond20', text: N('任意模拟中，单个盟约的层数达到20层'), need: 1, reward: 50, of: (s) => (s.bondPeak >= 20 ? 1 : 0) },
  { id: 'funny2', text: N('在【标准模拟】中通过第2回合'), need: 1, reward: 50, of: (s) => (s.best.FUNNY >= 2 ? 1 : 0) },
  { id: 'funny4', text: N('在【标准模拟】中通过第4回合'), need: 1, reward: 50, of: (s) => (s.best.FUNNY >= 4 ? 1 : 0) },
  { id: 'funny6', text: N('在【标准模拟】中通过第6回合'), need: 1, reward: 100, of: (s) => (s.best.FUNNY >= 6 ? 1 : 0) },
  { id: 'funny9', text: N('在【标准模拟】中通过第9回合'), need: 1, reward: 100, of: (s) => (s.best.FUNNY >= 9 ? 1 : 0) },
  { id: 'normal12', text: N('在【险境模拟】中通过第12回合'), need: 1, reward: 150, of: (s) => (s.best.NORMAL >= 12 ? 1 : 0) },
  { id: 'hard12', text: N('在【绝境模拟】中通过第12回合'), need: 1, reward: 200, of: (s) => (s.best.HARD >= 12 ? 1 : 0) },
  { id: 'abyss12', text: N('在【终极模拟】中通过第12回合'), need: 1, reward: 300, of: (s) => (s.best.ABYSS >= 12 ? 1 : 0) },
];
function N(s) { return s; }

const CLAIM_KEY = 'hub.keyGoalsClaimed';
const claimedSet = () => new Set((loadPref(CLAIM_KEY, []) || []).filter((x) => typeof x === 'string'));

/** Everything the hub shows, from the account's (or this device's) match records. */
export function hubProgress(records, now = Date.now()) {
  const cfg = getConfig()?.rewards || {};
  const daily = cfg.daily || { need: 200, bonus: 300, resetHour: 4 };
  const rs = (Array.isArray(records) ? records : []).filter((r) => r && r.test !== true && !isModdedRecord(r));
  const today = dayKey(now, daily.resetHour ?? 4);
  let exp = 0, trophies = 0, todayPts = 0, clears = 0;
  const best = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0]));
  for (const r of rs) {
    const self = selfRowOf(r);
    exp += int(self?.reward); trophies += int(self?.trophies);
    if (!countsTowardStats(r)) continue;
    const rounds = roundsOf(r);
    if (r.difficulty in best) best[r.difficulty] = Math.max(best[r.difficulty], rounds);
    if (self ? self.victory : r.victory) clears++;
    if (Number.isFinite(r.t) && dayKey(r.t, daily.resetHour ?? 4) === today) todayPts += dailyPointsFor(rounds, cfg.baseByRoundsPassed);
  }
  const peak = highestBondRecord(rs);
  const s = { clears, best, bondPeak: int(peak?.bond?.layers) };
  const claimed = claimedSet();
  const goals = KEY_GOALS.map((g) => {
    const have = Math.min(g.need, int(g.of(s)));
    const done = have >= g.need;
    return { ...g, have, done, claimed: done && claimed.has(g.id) };
  });
  return {
    exp, lv: levelOf(exp), trophies,
    daily: { have: Math.min(int(daily.need), todayPts), need: int(daily.need) || 200, bonus: int(daily.bonus) || 300, resetHour: daily.resetHour ?? 4 },
    goals, goalsDone: goals.filter((g) => g.done).length, goalsClaimable: goals.filter((g) => g.done && !g.claimed).length,
  };
}

export function useHubProgress() {
  useData('config');
  const cur = useRecords();
  const [tick, setTick] = useState(0);
  return { ...useMemo(() => hubProgress(cur.records), [cur, tick]), source: cur.source, refresh: () => setTick((n) => n + 1) };
}

// ---- top bar -----------------------------------------------------------------------------------------------------------

/** The page's own tools (设置, 录像, 背景…: not in the recording) fold behind one button when their row would reach the
 *  logo (4:3 screens, phones, touch sizes). Children keep their widths while folded, so the sum is the unfolded need. */
export function useToolsFold(ref) {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return undefined;
    const measure = () => {
      const left = bar.querySelector('.topbar__left'), tools = bar.querySelector('.topbar__tools');
      if (!left || !tools) return;
      const gap = parseFloat(getComputedStyle(tools).columnGap) || 0;
      const kids = [...tools.children].filter((c) => c.offsetWidth > 0);
      const rest = [...left.children].filter((c) => c !== tools && !c.classList.contains('oh-tools-toggle') && c.offsetWidth > 0);
      const need = [...kids, ...rest].reduce((n, c) => n + c.offsetWidth, 0) + gap * Math.max(0, kids.length - 1)
        + rest.length * (parseFloat(getComputedStyle(left).columnGap) || 0);
      const max = parseFloat(getComputedStyle(bar).maxWidth);
      setFolded(Number.isFinite(max) && need > max + 0.5);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    addEventListener('resize', measure);
    return () => { ro?.disconnect(); removeEventListener('resize', measure); };
  }, []);
  return folded;
}

/** The network lines over the 首页 button (drawn: the sprite of the common top bar is not in the event pack). */
const NET_PTS = [[8, 6], [30, 2], [55, 9], [80, 3], [104, 8], [120, 22], [96, 26], [70, 20], [44, 28], [18, 24], [3, 38], [28, 44], [60, 40], [90, 46], [116, 44]];
const NET_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0], [9, 10], [10, 11], [11, 8], [8, 12], [12, 7], [7, 2], [12, 13], [13, 6], [6, 4], [13, 14], [14, 5], [11, 12], [1, 8], [3, 7]];
function NetLines() {
  return html`<svg class="oh-nav__net" viewBox="0 0 124 50" aria-hidden="true">
    ${NET_LINKS.map(([a, b]) => html`<line x1=${NET_PTS[a][0]} y1=${NET_PTS[a][1]} x2=${NET_PTS[b][0]} y2=${NET_PTS[b][1]} />`)}
    ${NET_PTS.map(([x, y]) => html`<circle cx=${x} cy=${y} r="1.6" />`)}
  </svg>`;
}

/** ‹ and 首页; `home={false}` keeps the ‹ plate alone (the lobby: owner 2026-10-27, no 首页 there). */
export function HubNav({ onBack, onHome = onBack, backLabel = t('返回'), homeLabel = t('返回标题'), home = true }) {
  return html`<nav class=${cx('oh-nav', !home && 'oh-nav--solo')}>
    <button type="button" class="oh-nav__back" onClick=${onBack} title=${backLabel} aria-label=${backLabel}>
      <svg viewBox="0 0 20 32" aria-hidden="true"><path d="M17 2 3 16l14 14" /></svg>
    </button>
    ${home ? html`<button type="button" class="oh-nav__home" onClick=${onHome} title=${homeLabel} aria-label=${homeLabel}>
      <${NetLines} />
      <svg class="oh-nav__house" viewBox="0 0 32 28" aria-hidden="true"><path d="M16 1 1 14h4v13h8v-8h6v8h8V14h4z" /></svg>
    </button>` : null}
  </nav>`;
}

export function HubInfoButton() {
  return html`<button type="button" class="oh-info" onClick=${() => openGuide(0)} title=${t('玩法说明')} aria-label=${t('玩法说明')}>
    <img src=${ART + 'btn_info.png'} alt="" />
  </button>`;
}

/** The medal pill: 关键目标 reached / all (green when all are). */
export function HubMedal({ done, total, onOpen }) {
  const full = total > 0 && done >= total;
  return html`<button type="button" class=${cx('oh-medal', full && 'is-full')} onClick=${onOpen} title=${t('关键目标')}>
    <img class="oh-medal__icon" src=${ART + (full ? 'medal_full_icon.png' : 'medal_empty.png')} alt="" />
    ${full ? null : html`<i class="oh-medal__tick" aria-hidden="true"></i>`}
    <span class="oh-medal__n num"><b>${done}</b>/${total}</span>
  </button>`;
}

const pad = (n) => String(n).padStart(2, '0');
/** Where the official prints the event's end: the next 防卫目标 refresh (04:00) and the time left to it. */
export function HubEndTime({ resetHour = 4 }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const next = new Date(now);
  next.setHours(resetHour, 0, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  const left = next.getTime() - now;
  const h = Math.floor(left / 3600000), m = Math.max(1, Math.ceil((left % 3600000) / 60000));
  return html`<div class="oh-time" title=${t('每日防卫目标每天 04:00 重置')}>
    <i class="oh-time__clock" aria-hidden="true"></i>
    <span class="oh-time__label">${t('防卫目标刷新')}</span>
    <span class="oh-time__at num">${next.getFullYear()}/${pad(next.getMonth() + 1)}/${pad(next.getDate())} ${pad(resetHour)}:00</span>
    <span class="oh-time__left">${h ? t('剩余{h}小时', { h }) : t('剩余{m}分钟', { m })}</span>
  </div>`;
}

// ---- centre --------------------------------------------------------------------------------------------------------------

/** The event logo: the dot triangle in its frame, the two English lines, ALLIANCE, 卫戍协议：盟约 (dark on the dusk). */
export function HubLogo() {
  return html`<div class="oh-logo" aria-hidden="true">
    <i class="oh-logo__frame"></i>
    <img class="oh-logo__dots" src=${ART + 'season_logo.png'} alt="" />
    <img class="oh-logo__l1" src=${ART + 'title_desc_01.png'} alt="" />
    <img class="oh-logo__l2" src=${ART + 'title_desc_02.png'} alt="" />
    <i class="oh-logo__en"></i>
  </div>
  <h1 class="oh-title">${t('卫戍协议')}<span class="oh-title__colon">:</span> <b>${t('盟约')}</b></h1>`;
}

// ---- left column -------------------------------------------------------------------------------------------------------

/** 成就统计: the dusk card with the event logo, the trophy-level piece and count, and the label strip (layout btn_achievement). */
export function HubAchCard({ trophies, guest, onOpen }) {
  return html`<button type="button" class=${cx('oh-ach', guest && 'is-guest')} onClick=${onOpen} title=${guest ? t('成就统计 · 登录账号后记录') : t('成就统计')}>
    <img class="oh-ach__scene" src=${ART + 'btn_achievement.png'} alt="" />
    <span class="oh-ach__rank" aria-hidden="true"><${TrophyBadge} count=${guest ? 0 : trophies} class="oh-ach__medal" title="" />
      <small class="oh-ach__count"><b class="num">${guest ? '—' : trophies}</b></small></span>
    <span class="oh-ach__label"><i class="oh-ach__icon"></i><span>${t('成就统计')}</span></span>
  </button>`;
}

function RedDot() { return html`<i class="oh-dot" aria-hidden="true"></i>`; }

export function HubIconButton({ kind, label, onClick, done = false }) {
  const src = kind === 'reward' ? 'btn_reward.png' : done ? 'btn_daily_finish.png' : 'btn_daily_normal.png';
  return html`<button type="button" class=${cx('oh-ibtn', `oh-ibtn--${kind}`)} onClick=${onClick}>
    <img src=${ART + src} alt="" /><span>${label}</span>
  </button>`;
}

export function HubMissionButton({ claimable, onClick }) {
  return html`<button type="button" class="oh-mission" onClick=${onClick}>
    <img src=${ART + 'btn_mission.png'} alt="" /><span>${t('关键目标')}</span>${claimable ? html`<${RedDot} />` : null}
  </button>`;
}

export function HubMilestoneButton({ lv, onClick }) {
  const pct = lv.max ? 100 : Math.round((lv.into / lv.need) * 100);
  return html`<button type="button" class=${cx('oh-mile', lv.max && 'is-max')} onClick=${onClick} title=${t('功勋兑换处 · 卫戍认证 {exp}/{need}', { exp: lv.into, need: lv.need })}>
    <img class="oh-mile__bg" src=${ART + 'btn_mileStone.png'} alt="" />
    <img class="oh-mile__coin" src=${ART + 'img_coin.png'} alt="" />
    <small class="oh-mile__lvt">LV</small><b class="oh-mile__lv num">${lv.lv}</b>
    <span class="oh-mile__name">${t('功勋兑换处')}</span>
    ${lv.max ? html`<img class="oh-mile__max" src=${ART + 'btn_mileStone_max.png'} alt="MAX" />` : null}
    <i class="oh-mile__bar"><i style=${{ width: `${pct}%` }}></i></i>
  </button>`;
}

// ---- right column ------------------------------------------------------------------------------------------------------

export function HubPlate({ kind, label, onClick, badge = null }) {
  return html`<button type="button" class=${cx('oh-plate', `oh-plate--${kind}`)} onClick=${onClick}>
    <img src=${ART + (kind === 'sweep' ? 'btn_team_info.png' : 'btn_chess_pool.png')} alt="" /><span>${label}</span>${badge}
  </button>`;
}

export function HubInvite({ count = 0, onClick }) {
  return html`<button type="button" class="oh-invite" onClick=${onClick} title=${t('正在招募的同盟')}>
    <img src=${ART + 'btn_invite.png'} alt="" /><span>${t('模拟邀约')}</span>${count ? html`<b class="oh-invite__n num">${count}</b>` : null}
  </button>`;
}

// ---- entries -------------------------------------------------------------------------------------------------------------

export function HubEntries({ onSolo, onCoop, onSearch, coopCount = null, isNew = {} }) {
  const Entry = ({ k, art, label, onClick, extra }) => html`<button type="button" class=${cx('oh-entry', `oh-entry--${k}`)} onClick=${onClick}>
    <img class="oh-entry__art" src=${ART + art} alt="" /><span class="oh-entry__label">${label}</span>${extra}
    ${isNew[k] ? html`<img class="oh-entry__new" src=${ART + 'img_new.png'} alt="NEW" />` : null}
  </button>`;
  return html`<section class="oh-entries" aria-label=${t('模拟方式')}>
    <div class="oh-group oh-group--solo">
      <h2 class="oh-group__head"><img src=${ART + 'img_mode_single.png'} alt="" />${t('独立模拟')}</h2>
      <${Entry} k="solo" art="btn_single.png" label=${t('独立模拟')} onClick=${onSolo} />
    </div>
    <div class="oh-group oh-group--multi">
      <h2 class="oh-group__head"><img src=${ART + 'img_mode_multi.png'} alt="" />${t('同盟模拟')}</h2>
      <${Entry} k="coop" art="btn_team.png" label=${t('联合模拟')} onClick=${onCoop}
        extra=${Number.isFinite(coopCount) && coopCount > 0 ? html`<small class="oh-entry__count num">${t('{n} 人匹配中', { n: coopCount })}</small>` : null} />
      <${Entry} k="search" art="btn_match.png" label=${t('搜寻队友')} onClick=${onSearch} />
    </div>
  </section>`;
}

// ---- 独立模拟停放（业主 2026-11-14）------------------------------------------------------------------------------
// 暂离后房间保留 24 小时，开始界面**维持原布局**，两个按键就待在各自原来的位置上：
//   搜寻队友的位置 → 「继续游戏」（沿用搜寻队友按键的样式，圆胶囊显示剩余时间）
//   同盟模拟（联合模拟）的位置 → 「结束模拟」（沿用该按键的 UI，红色 + 拉高）
// 独立模拟的位置不再提供（暂离期间不能开新局），因此整组不渲染。
/** 阶段名的可读文案（业主 2026-11-14：显示在「继续游戏」按键上）。 */
function phaseLabel(parked) {
  const ph = String(parked?.phase || '').toUpperCase();
  const round = Number(parked?.round) || 0;
  const map = {
    INFO_CHECK: '确认本局信息', PREP: '干员调配', BAND_DRAFT: '选择策略', DRAFT: '选择策略',
    ROUND_START: '回合开始', COMBAT: '作战中', FINAL_ASSAULT: '最终防线',
    SETTLE: '结算', HIDDEN_CORE: '隐藏核心',
  };
  const name = map[ph] || (parked?.inMatch ? '对局中' : '准备中');
  return round > 0 ? `第 ${round} 回合 · ${name}` : name;
}

export function ParkedSoloEntries({ parked, onResume, onEnd, busy = null }) {
  // 倒计时每秒走一格（业主 2026-11-14「倒计时不滚动」）：之前只在拉取时算了一次，所以是静止的。
  // 用服务端给的 expiresAt 减当前时间，本地时间与服务端有偏差时退回 remainingMs 做基准。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!parked) return null;
  const base = Number.isFinite(parked.expiresAt) ? parked.expiresAt - now : Number(parked.remainingMs) || 0;
  const left = Math.max(0, base);
  const hh = String(Math.floor(left / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  const Entry = ({ k, art, label, onClick, extra, disabled }) => html`<button type="button"
      class=${cx('oh-entry', `oh-entry--${k}`)} onClick=${onClick} disabled=${disabled}>
    <img class="oh-entry__art" src=${ART + art} alt="" /><span class="oh-entry__label">${label}</span>${extra}
  </button>`;
  return html`<section class="oh-entries" aria-label=${t('继续模拟')}>
    <div class="oh-group oh-group--multi">
      <h2 class="oh-group__head"><img src=${ART + 'img_mode_multi.png'} alt="" />${t('同盟模拟')}</h2>
      <${Entry} k="coop oh-entry--end" art="btn_team.png" label=${t('结束模拟')} onClick=${onEnd} disabled=${busy === 'end'} />
      <${Entry} k="search oh-entry--resume" art="btn_match.png" label=${t('继续游戏')}
        onClick=${onResume} disabled=${busy === 'resume'}
        extra=${html`<span class="oh-parked__phase">${phaseLabel(parked)}</span><span class="oh-parked__pill num" title=${t('剩余时间')}>${hh}:${mm}:${ss}</span>`} />
    </div>
  </section>`;
}

// ---- dialogs -------------------------------------------------------------------------------------------------------------

/** Esc closes; a click on the backdrop closes. */
function useEscape(onClose) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
}

/** 每日防卫目标 (the recording 1:14–1:20): a band across the blurred lobby. */
export function DailyGoalPanel({ daily, onClose }) {
  useEscape(onClose);
  const pct = Math.min(100, Math.round((daily.have / daily.need) * 100));
  return html`<div class="oh-veil oh-daily" role="dialog" aria-label=${t('每日防卫目标')} onClick=${onClose}>
    <div class="oh-daily__band">
      <div class="oh-daily__body">
        <h2><img src=${ART + 'img_icon.png'} alt="" />${t('每日防卫目标')}</h2>
        <div class="oh-daily__bar"><i><i style=${{ width: `${pct}%` }}></i></i><span class="num"><b>${daily.have}</b>/${daily.need}</span></div>
        <p>${t('通过模拟累积获得【卫戍认证】')}x<b class="num">${daily.need}</b>${t('，即可在结算时领取【卫戍认证】')}x<b class="num">${daily.bonus}</b>${t('的额外奖励。')}<br />
          ${t('*奖励每日一次，每天{h}:00重置', { h: pad(daily.resetHour) })}</p>
      </div>
    </div>
  </div>`;
}

/** 报酬说明 (the recording 1:05–1:12): the reward formula, the per-round table and the two factors. */
export function RewardRulesPanel({ onClose }) {
  useEscape(onClose);
  const cfg = getConfig()?.rewards || {};
  const rows = Array.isArray(cfg.baseByRoundsPassed) ? cfg.baseByRoundsPassed : [];
  const df = cfg.difficultyFactor || {}, mf = cfg.modeFactor || {};
  const strip = useRef(null);
  const toEnd = (e) => { e.stopPropagation(); const el = strip.current; if (el) el.scrollTo({ left: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 ? 0 : el.scrollWidth, behavior: 'smooth' }); };
  return html`<div class="oh-veil oh-rules" role="dialog" aria-label=${t('报酬说明')} onClick=${onClose}>
    <div class="oh-rules__box" onClick=${(e) => e.stopPropagation()}>
      <header class="oh-rules__head"><img src=${ART + 'img_title_1105x166.png'} alt="" />
        <p><img src=${ART + 'img_point.png'} alt="" /><b>${t('卫戍认证数量')}</b>=${t('回合奖励')}*${t('难度评级')}*${t('同盟评级')}</p>
        <button type="button" class="oh-close" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button>
      </header>
      <div class="oh-rules__table">
        <div class="oh-rules__keys"><span>${t('回合数')}</span><span>${t('回合奖励')}</span></div>
        <div class="oh-rules__strip" ref=${strip}>
          ${rows.map((r) => html`<div class="oh-rules__col"><b class="num">${r.round}</b><span class="num"><img src=${ART + 'img_point.png'} alt="" />${r.count}</span></div>`)}
        </div>
        <button type="button" class="oh-rules__jump" onClick=${toEnd} aria-label=${t('翻到末尾')}><img src=${ART + 'img_jump.png'} alt="" /></button>
      </div>
      <div class="oh-rules__factors">
        <div class="oh-rules__fac oh-rules__fac--diff"><span class="oh-rules__fk">${t('难度评级')}</span>
          ${DIFFICULTIES.filter((d) => df[d] != null).map((d) => html`<div class=${`oh-rules__fv is-${d.toLowerCase()}`}>
            <small><img src=${ART + DIFF_ICON[d] + '.png'} alt="" />${t(DIFFICULTY_NAMES[d])}</small><b class="num">×${df[d]}</b></div>`)}
        </div>
        <div class="oh-rules__fac oh-rules__fac--mode"><span class="oh-rules__fk">${t('同盟评级')}</span>
          <div class="oh-rules__fv"><small><img src=${ART + 'img_mode_single.png'} alt="" />${t('独立模拟')}</small><b class="num">×${mf.SINGLE ?? 1}</b></div>
          <div class="oh-rules__fv"><small><img src=${ART + 'img_mode_multi.png'} alt="" />${t('同盟模拟')}</small><b class="num">×${mf.MULTI ?? 1}</b></div>
        </div>
      </div>
    </div>
  </div>`;
}

/** 关键目标 (the recording 0:31–0:36): a page of its own — the map on the left, the task list on the right. */
export function KeyGoalsPage({ prog, onClose, onHome }) {
  useEscape(onClose);
  const claim = (ids) => {
    const set = claimedSet();
    ids.forEach((id) => set.add(id));
    savePref(CLAIM_KEY, [...set]);
    prog.refresh();
    toast(t('已领取 {n} 项关键目标', { n: ids.length }), 'info');
  };
  const order = (g) => (g.done && !g.claimed ? 0 : g.done ? 2 : 1);
  const list = [...prog.goals].sort((a, b) => order(a) - order(b));
  const ready = list.filter((g) => g.done && !g.claimed).map((g) => g.id);
  return html`<div class="oh-page oh-goals" role="dialog" aria-label=${t('关键目标')}>
    <${HubNav} onBack=${onClose} onHome=${onHome || onClose} backLabel=${t('返回主界面')} />
    <header class="oh-page__head"><span class="oh-goals__tasks"><svg viewBox="0 0 24 24"><path d="M8 2h8v3H8zM5 4h2v3h10V4h2v18H5zm3 7v2h8v-2zm0 4v2h8v-2z" /></svg><small>tasks</small></span>
      <span class="oh-page__plate"><img src=${ART + 'btn_mission.png'} alt="" /><b>${t('关键目标')}</b></span></header>
    <img class="oh-goals__map" src=${ART + 'img_deco_left.png'} alt="" />
    <div class="oh-goals__list">
      <div class=${cx('oh-goals__claim', !ready.length && 'is-none')}>
        <img src=${ART + 'btn_claim_all.png'} alt="" />
        <span>${ready.length ? t('当前有已完成待领取的任务') : t('已完成 {n}/{m} 项关键目标', { n: prog.goalsDone, m: prog.goals.length })}</span>
        <button type="button" disabled=${!ready.length} onClick=${() => claim(ready)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4v9h4l-6 7-6-7h4z" /></svg><b>${t('一键领取')}</b></button>
      </div>
      ${list.map((g) => html`<div class=${cx('oh-goal', g.claimed ? 'is-claimed' : g.done ? 'is-ready' : 'is-open')} key=${g.id}
          onClick=${g.done && !g.claimed ? () => claim([g.id]) : undefined}>
        <img class="oh-goal__bg" src=${ART + (g.claimed ? 'img_item_unfinished.png' : g.done ? 'img_item_claimable.png' : 'img_item_unfinished.png')} alt="" />
        <p class="oh-goal__text">${t(g.text)}</p>
        <div class="oh-goal__proc"><span class="num">${g.have}/${g.need}</span><i><i style=${{ width: `${Math.round((g.have / g.need) * 100)}%` }}></i></i></div>
        <div class="oh-goal__reward"><img src=${ART + 'img_coin.png'} alt="" /><b class="num">${g.reward}</b></div>
        ${g.claimed ? html`<img class="oh-goal__done" src=${ART + 'img_item_claimed.png'} alt=${t('已完成')} />` : null}
      </div>`)}
    </div>
  </div>`;
}

/** 功勋兑换处 (the recording 1:01–1:05): LV of the 卫戍认证 collected, the level cards, the event's featured rewards. */
export function MilestonePage({ prog, onClose, onHome }) {
  useEscape(onClose);
  const lv = prog.lv;
  const strip = useRef(null);
  useEffect(() => {
    const el = strip.current, card = el?.querySelector('.oh-lvcard.is-cur');
    if (el && card) el.scrollLeft = Math.max(0, card.offsetLeft - el.clientWidth / 2 + card.clientWidth / 2);
  }, []);
  const pct = lv.max ? 100 : Math.round((lv.into / lv.need) * 100);
  const levels = Array.from({ length: LV_MAX }, (_, i) => i + 1);
  return html`<div class="oh-page oh-mpage" role="dialog" aria-label=${t('功勋兑换处')}>
    <div class="oh-mpage__feature" aria-hidden="true">
      <img class="oh-mpage__skin" src=${ART + 'big_reward_skin.png'} alt="" />
      <img class="oh-mpage__logo" src=${ART + 'deco_logo.png'} alt="" />
      <span class="oh-mpage__who">${t('活动时装')}</span><span class="oh-mpage__skinname">${t('功勋奖励')}</span>
      <small class="oh-mpage__note">${t('*官方活动功勋奖励（展示）')}</small>
      <img class="oh-mpage__avatar" src=${ART + 'big_reward_avatar.png'} alt="" />
      <span class="oh-mpage__avkind">${t('头像')}</span><span class="oh-mpage__avname">${t('活动头像')}</span>
    </div>
    <${HubNav} onBack=${onClose} onHome=${onHome || onClose} backLabel=${t('返回主界面')} />
    <section class="oh-mpage__head">
      <h2><img src=${ART + 'deco_title.png'} alt="" /><span>${t('功勋兑换处')}</span></h2>
      <img class="oh-mpage__coin" src=${ART + 'img_coin.png'} alt="" />
      <div class="oh-mpage__lv"><small>LV.</small><b class="num">${lv.lv}</b>${lv.max ? html`<img src=${ART + 'part_level_max.png'} alt="MAX" />` : html`<span class="num">${lv.into}/${lv.need}</span>`}</div>
      <i class="oh-mpage__bar"><i style=${{ width: `${pct}%` }}></i></i>
      <p class="oh-mpage__sum">${t('累计获得【卫戍认证】')}<b class="num">${prog.exp}</b></p>
    </section>
    <div class="oh-mpage__strip" ref=${strip}>
      ${levels.map((n) => {
        const reached = lv.lv >= n;
        return html`<div class=${cx('oh-lvcard', reached ? 'is-got' : 'is-open', n === lv.lv && 'is-cur')} key=${n}>
          <img class="oh-lvcard__bg" src=${ART + (reached ? 'bkg_item_claim.png' : 'bkg_item_norm.png')} alt="" />
          ${reached && n < lv.lv ? html`<img class="oh-lvcard__mask" src=${ART + 'mask_item_claimed.png'} alt="" />` : null}
          <span class="oh-lvcard__lv"><small>LV.</small><b class="num">${n}</b></span>
          <span class="oh-lvcard__cond">${t('功勋兑换处等级达')}</span>
          <span class="oh-lvcard__need num">${(n - 1) * LV_EXP}</span>
        </div>`;
      })}
    </div>
  </div>`;
}
