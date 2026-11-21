// public/js/ui/overlimitRelics.js — 超限模拟「词条」（饰品）的三选一浮层（业主 2026-10-31）。
//
// 它**复用炸惊惊变那一套版式**：`.zjov` / `.zjov__*` / `.zjcard` / `.zjcard__*` 全部来自 css/screens/jibian.css，
// 尺寸单位仍是那一族的 `--zj-u`（= min(1rem, 100svh/10.8)），所以局内 / 局外、手机与桌面的观感与惊变三选一逐像素同级。
// 本文件只补三件小事（样式在 css/screens/overlimitRelics.css）：
//   · 抬头 .zjov__micro 换成 OVERLIMIT // RELIC（文案是技术眉题，不是 i18n 词条）；
//   · 每张卡的左上小字是**词条编号**（LC-001 / FGO-Ⅹ…，数据，不翻译）；
//   · 效果还没实装的卡（`impl: 'pending'`：第一批 36 条全部如此；第二批实装 A 类 29 条后只剩 B 类 7 条）右上角一枚极小的角标。
//
// 数据：`m.public.sp = { family: 'overlimit', relicKind, round, cards: [{ idx, kind: 'overlimit', id, name, desc,
// flavor, group, impl, effectColor, icon }], order, turn, picks, taken, untimed }`（server/match/match/relicDraft.js）。
// 选卡走既有 `g.choice { idx }`（ui/gameActions.js choice），两段式点击与机变 / 惊变 / 藏品一致：
// 第一次点只把卡置为「已选」（高亮 + 确认键亮起），再点同一张卡或点「确认选择」才发 g.choice；点别处 / Esc 取消。
// 没有重抽（业主定稿：选到的结果不重掷、不提供 reroll），所以这里也不画重抽按钮。
//
// **已选饰品面板**（业主 2026-10-31 追加，同日改名）：局内左下角一颗「已选饰品」独立键（ui/hud.js RelicHudButton）+ 点开的面板
// （本文件 OverlimitRelicPanel）—— 做法照抄炸惊的「已选惊变」：按钮与设置 / 对话 / 惊变同一行、同一尺寸（.gm__gear），
// 面板直接套 jibian.css 的 .zjpanel 壳与 .zjsel 横行。**只在超限局出现**：认 `m.private.relicsOverlimit`（服务端只对
// `Match.isInfinite` 下发，见下）。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from './components.js';
import { Img, GIcon, RichText } from './gameComponents.js';
import { cardPickable, pickBusy, spTap, armedCard } from './choiceOverlay.js';
import { ensureJibianCss } from './jibian.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

let cssLoaded = false;
/**
 * The relic overlay's stylesheetS, loaded on first draw — **two of them, in this order**:
 *   1. `css/screens/jibian.css` — every `.zjov` / `.zjcard` rule and the `--zj-u` scale live there. 复用 ui/jibian.js
 *      的 `ensureCss()`（导出名 `ensureJibianCss`），不复制第二份 loader。
 *   2. `css/screens/overlimitRelics.css` — this file's few overrides on top of it.
 * 冷启动路径（超限局里第一次遇到词条三选一、此前从没开过炸惊）正是漏了第 1 步：jibian.css 是按需加载的，
 * 只有 JibianDraftView / JibianPanel / EnemyJibianRevealView 画过才会进 DOM，于是浮层裸奔（220px 高、
 * 三张 33px 横条）。开过一次炸惊再回大厅就「自己好了」——所以这是加载顺序问题，不是版式问题。
 */
export function ensureRelicCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  ensureJibianCss();
  if (document.querySelector('link[data-overlimit-relics]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/overlimitRelics.css';
  link.dataset.overlimitRelics = '1';
  document.head.appendChild(link);
}

/**
 * 「未实装」角标用哪句文案：**必须是既有 msgid**（业主纪律：新增 i18n 字面量要先报）。
 * 现在借用 `t('暂不可用')`（既有键，四语都有）；等业主批下「未实装」这个字面量后，改这一处 + 补 public/i18n/*.json 即可。
 */
const pendingLabel = () => t('暂不可用');

/**
 * 一张词条卡。`armed` = 两段式选择的当前卡（抬起 + 显示「确认选择 · 再次点击」）。
 * @param {{ card: any, can: boolean, busy?: boolean, armed?: boolean, onTap?: (idx: number) => void }} props
 */
function RelicCard({ card, can, busy = false, armed = false, onTap = () => {} }) {
  // 名字按**当前这一档**显示（业主 2026-11-01）：带 Ⅰ/Ⅱ/Ⅲ 的负面词条卡面标题是「破坏力Ⅱ」，不是数据里那条
  // 「破坏力Ⅰ/Ⅱ/Ⅲ」；无档位条目 / 正面饰品 `cardTierLabel` → null，`tierName` 原样返回（一个字节都不动）。
  // aria-label / title 用的是同一个 `name`，悬停也不会再看到「Ⅰ/Ⅱ/Ⅲ」。
  // 正因为名字已经自带当前档，**编号旁那枚档位小片（原来的 `.zjcard__tier`）已撤掉**（业主 2026-11-01 收尾：
  // 名字带档以后那枚小片是重复信息）；分档三行行首的 Ⅰ/Ⅱ/Ⅲ 标记保留，那是区分三行的唯一标识（见下面 `tiers`）。
  const name = tierName(card.name || card.id || t('词条'), cardTierLabel(card));
  const pending = card.impl === 'pending';
  // 档位分条（业主 2026-11-01）：带 Ⅰ/Ⅱ/Ⅲ 的负面词条不再画成一条合并文案，改为每档一行（档位标记 + 该档
  // 自己的 effect），当前这一档 is-cur。没有档位的卡走原来的 RichText 整段 desc（一个字节都不变）。
  const tiers = cardTierRows(card);
  // 图标是数据字段 `card.icon`（`/assets/relics/overlimit/<词条编号>.png`，业主表里 DISPIMG 嵌入图解出来的那 36 张）。
  // 没有路径、或 <img> 加载失败，都落回原来的占位符（Img 自带 onError → fallback），不新增任何文案 / DOM。
  // 负面词条（业主 2026-10-31 第二批）：`card.negative` 让这张卡带 `is-neg`（警示描边 / 编号色）；档位（Ⅰ/Ⅱ/Ⅲ）
  // 现在只出现在名字末尾（`tierName`）与分档三行的行首标记上 —— 编号旁那枚档位小片已按业主收尾口径撤掉。
  return html`<button type="button" class=${cx('zjcard', can && 'is-pickable', armed && 'is-armed', busy && 'is-busy', card.negative && 'is-neg')}
      data-group=${card.group || null} data-impl=${card.impl || null} data-negative=${card.negative ? 'true' : null} disabled=${!can}
      aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(armed) : undefined}
      data-testid=${`relic-card-${card.idx}`}
      aria-label=${armed ? t('{name}，已选中，再次点击确认', { name }) : name}
      title=${[name, card.desc || '', card.flavor ? `「${card.flavor}」` : ''].filter(Boolean).join('\n')}
      onClick=${() => { if (can) onTap(card.idx); }}>
    <span class="zjcard__top">
      <span class="zjcard__icon">
        <${Img} src=${card.icon || null} fallback=${html`<${GIcon} name="bolt" />`} />
      </span>
      <span class="zjcard__titles">
        <b class="zjcard__name">${name}</b>
        <span class="zjcard__rarity">${card.id || ''}</span>
      </span>
      ${pending ? html`<span class="zjcard__pending" role="note" data-testid=${`relic-pending-${card.idx}`}>${pendingLabel()}</span>` : null}
    </span>
    ${tiers
      ? html`<div class="zjcard__tiers" data-testid=${`relic-tiers-${card.idx}`}>${tiers.map((x) => html`<span key=${x.label}
          class=${cx('zjcard__tierline', x.cur && 'is-cur')} data-cur=${x.cur ? 'true' : null}
          data-testid=${`relic-tierline-${card.idx}-${x.label}`}>
          <i class="zjcard__tierlab num">${x.label}</i><${RichText} text=${x.text} /></span>`)}</div>`
      : html`<${RichText} text=${card.desc || ''} class="zjcard__desc" />`}
    ${card.flavor ? html`<span class="zjcard__flavor">${card.flavor}</span>` : null}
    ${armed ? html`<span class="zjcard__confirm" role="status"><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
    ${busy ? html`<span class="zjcard__busy" role="status">${t('选择中')}</span>` : null}
  </button>`;
}

/**
 * 词条三选一：状态机（hooks）。`sp` 是 `normalizeSp(m.public.sp)`（family 'overlimit'）。
 * 除 family 之外与惊变浮层完全同一套交互：`spTap` / `armedCard` / `cardPickable` / `pickBusy` 全部复用
 * ui/choiceOverlay.js（不另写一套两段式点击）。
 * @param {{ sp: any, myId: string, solo?: boolean, busyIdx?: number|null, onPick?: (idx: number) => void }} props
 */
export function OverlimitRelicOverlay({ sp, myId, solo = false, busyIdx = null, onPick = () => {} }) {
  const [sel, setSel] = useState(null);
  const armed = armedCard(sel, sp, { myId, solo, busyIdx });
  useEffect(() => { if (sel != null && armed == null) setSel(null); }, [sel, armed]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);
  if (!sp || sp.family !== 'overlimit' || !sp.cards.length) return null;
  const tap = (idx) => {
    const card = sp.cards.find((c) => c && c.idx === idx);
    const r = spTap(armed, idx, cardPickable(sp, card, { myId, solo, busyIdx }));
    setSel(r.armed);
    if (r.pick != null) onPick(r.pick);
  };
  return html`<${OverlimitRelicDraftView} sp=${sp} myId=${myId} solo=${solo} busyIdx=${busyIdx} armed=${armed}
    onTap=${tap} onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
}

/**
 * 纯视图（无 hooks —— test/ui 直接把当函数画，与 JibianDraftView / ChoiceView 同一个拆分）。
 * 抬头标题用既有 msgid `t('词条抉择')`（超限 TRAIT_DRAFT 浮层也在用），副标题沿用 `t('选择一项（无时间限制）')`
 * 与 `t(' · 点击卡牌选中，再次点击确认')`，一个字节的新文案都没有。
 * @param {{ sp: any, myId: string, solo?: boolean, busyIdx?: number|null, armed?: number|null,
 *   onTap?: (idx: number) => void, onConfirm?: () => void, onDisarm?: () => void }} props
 */
export function OverlimitRelicDraftView({ sp, myId, solo = false, busyIdx = null, armed = null,
  onTap = () => {}, onConfirm = () => {}, onDisarm = () => {} }) {
  ensureRelicCss();
  if (!sp || sp.family !== 'overlimit' || !sp.cards.length) return null;
  const myTurn = solo || sp.turnPid === myId;
  const mine = sp.pickOf.get(myId);
  const timed = !solo && !sp.untimed;
  // 负面池的判据：`normalizeSp` 只保留 family / 名字 / 卡与轮次，所以 sp 级的 `negative` 可能被它摘掉 ——
  // 卡面自己带的 `card.negative`（服务端 negativeCardView）是第二道判据，两边任一成立就按负面浮层画。
  const negative = sp.negative === true || sp.cards.some((c) => c && c.negative === true);
  const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
  // 确认键的 title 也按**当前这一档**的名字（与卡面标题同一个 `tierName`，不再悬停看到「Ⅰ/Ⅱ/Ⅲ」）。
  const armedName = armedCardRec ? tierName(armedCardRec.name || armedCardRec.id || t('词条'), cardTierLabel(armedCardRec)) : null;
  // 点任意非卡片 / 非确认键的地方取消选中
  const onDown = (e) => {
    if (armed == null) return;
    const node = e.target;
    if (node && typeof node.closest === 'function' && node.closest('.zjcard, .zjov__confirm')) return;
    onDisarm();
  };
  return html`<div class=${cx('zjov', 'zjov--relic', negative && 'zjov--neg', armed != null && 'has-armed')} role="dialog" aria-modal="true"
      aria-label=${t('词条抉择')} data-testid="overlimit-relic-overlay" data-negative=${negative ? 'true' : null} onPointerDown=${onDown}>
    <div class="zjov__veil" aria-hidden="true"></div>
    <div class="zjov__inner">
      <header class="zjov__head">
        <span class="zjov__micro">${negative ? 'OVERLIMIT // NEGATIVE' : 'OVERLIMIT // RELIC'}</span>
        <h2 class="zjov__title">${t('词条抉择')}</h2>
        <p class="zjov__sub">${timed ? t('倒计时结束后仍未选定将自动分配') : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        <div class="zjov__turn">
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="zjov__confirm" data-testid="overlimit-relic-confirm"
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>`
          : html`<span class=${cx('zjov__state', myTurn && mine == null && 'is-mine')}>
              ${mine != null ? html`<${Icon} name="check" />${t('已完成选择')}`
                : myTurn ? html`<${Icon} name="hourglass" />${t('当前轮到你决策')}`
                : html`<${Icon} name="dots" />${t('正在决策…')}`}
            </span>`}
        </div>
      </header>
      <div class=${cx('zjov__grid', sp.cards.length <= 3 && 'zjov__grid--3')}>
        ${sp.cards.map((card) => html`<${RelicCard} key=${card.idx} card=${card}
          can=${cardPickable(sp, card, { myId, solo, busyIdx })} armed=${armed === card.idx}
          busy=${pickBusy(busyIdx, card, mine)} onTap=${onTap} />`)}
      </div>
    </div>
  </div>`;
}

/**
 * 词条表（data/relicsOverlimit.json，`{ entries: [...] }`）—— 表还没到货时是空数组。
 * 同一份表在局外 S.W.E.E.P. 的词条页（screens/sweep.js relicEntriesOf）也读；那边是整页图鉴，这里是局内面板，
 * 两边各自三行取值，不共用页面骨架（业主口径）。
 * @returns {any[]}
 */
function relicEntries() {
  const table = data.get('relicsOverlimit');
  return table && Array.isArray(table.entries) ? table.entries.filter((e) => e && typeof e.id === 'string') : [];
}

/**
 * 负面词条表（data/relicsOverlimitNegative.json，`{ entries: [...] }`，业主 2026-10-31 第二批）。
 * 面板把负面词条**列在同一块列表里**、用分组色（`neg`，警示红）区分 —— 业主未定，先按这个做。
 * @returns {any[]}
 */
function negativeEntries() {
  const table = data.get('relicsOverlimitNegative');
  return table && Array.isArray(table.entries) ? table.entries.filter((e) => e && typeof e.id === 'string') : [];
}

/**
 * 一条**带档位**负面词条的 desc → 每档一份 effect 文案（业主 2026-11-01：局内按档拆开显示）。
 *
 * 表里 D01…D08 是「一个名称、一段描述里三个数值，用 ` / ` 分开」（tierNote 已写明），例如
 * `我方每回合发放的经费 -2 / -4 / -6`、`敌方生命值 + 10% / 15% / 25%，受到的伤害 - 15% / 20% / 25%，造成的伤害 + 10%`。
 * 所以拆法就是**按小句**（`，`）走：小句里有 n 段 ` / ` 取值时，第 i 档取第 i 段；没有斜杠的小句（与档位无关的
 * 固定部分，如「造成的伤害 + 10%」）三档都带上。**只拆显示、不改数据**（data/relicsOverlimitNegative.json 仍是
 * 一条 3 档，抽取 / 战斗侧读的仍是 `tiers[].v`）。
 * @param {string} desc 数据里的 desc
 * @param {number} count 档数（= tiers.length）
 * @returns {string[]} 长度 = count；拆不出来时每档都是整段原文（不丢文案）
 */
export function tierTexts(desc, count) {
  const text = typeof desc === 'string' ? desc : '';
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  if (!text || n < 2) return new Array(n).fill(text);
  const clauses = text.split('，');
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(clauses.map((clause) => tierClause(clause, n, i)).join('，'));
  }
  return out;
}

/** 小句里的数值（可能带 % / 负号；表里三档都是同一形状的数字）。 */
const TIER_NUM = /-?\d+(?:\.\d+)?%?/;

/**
 * 一个小句 → 第 i 档的读法。`a 20% / 30% / 45% b` 这种写法里，第一段带着前缀（`a`）、最后一段带着后缀（`b`），
 * 中间两段只有数值，所以不能直接取 `parts[i]`：要先从前缀 / 后缀里把模板拆出来，再塞进第 i 档的数值。
 * 斜杠段数不等于档数时（表里写死的固定部分，如 `造成的伤害 + 10%`）原样保留，不猜。
 *
 * 导出（业主 2026-11-01 收尾）：局外的 S.W.E.E.P. 词条详情（screens/sweep.js）按同一套口径拆档，走 `tierRowsOf`
 * —— 它内部就是「按 `，` 切 + 逐小句 `tierClause`」。导出只把这份切分口径摆到明面上，实现与输出一个字节不变。
 * @param {string} clause
 * @param {number} n 档数
 * @param {number} i 第几档
 */
export function tierClause(clause, n, i) {
  const parts = clause.split(' / ');
  if (parts.length !== n) return clause;
  // 第一段：前缀 + 第一个数值（如「我方每回合发放的经费 -2」「敌方获得 20%」）
  const first = /^(.*?)(-?\d+(?:\.\d+)?%?)\s*$/.exec(parts[0]);
  if (!first) return clause;
  // 最后一段：数值 + 后缀（如「45% 造成的伤害提升」；没有后缀时就是纯数值）
  const last = new RegExp(`^\\s*(${TIER_NUM.source})([\\s\\S]*)$`).exec(parts[n - 1]);
  const tail = last ? last[2] : '';
  const value = i === 0 ? first[2] : (i === n - 1 && last ? last[1] : parts[i].trim());
  return `${first[1]}${value}${tail}`;
}

/**
 * 名字**末尾**的档位标记：`Ⅰ/Ⅱ/Ⅲ`，也兼容 `Ⅰ/Ⅱ`、`Ⅰ/Ⅱ/Ⅲ/Ⅳ` 这种变体（数据里 D01–D08 的 `name` 就是
 * 「破坏力Ⅰ/Ⅱ/Ⅲ」「基础威力增强Ⅰ/Ⅱ/Ⅲ」—— 一个名字里写死了三档）。
 */
const TIER_MARK = /(?:[ⅠⅡⅢⅣⅤ]\/)+[ⅠⅡⅢⅣⅤ]$/;

/**
 * 名字 → **当前这一档**的名字（业主 2026-11-01：「是什么阶段的就是什么阶段」）。
 * 把 name 末尾的 `Ⅰ/Ⅱ/Ⅲ` 剥掉、拼上当前档 `label`：`tierName('破坏力Ⅰ/Ⅱ/Ⅲ', 'Ⅱ') === '破坏力Ⅱ'`。
 * **没有档位标记的名字原样返回**（D09…D16B 这些无档条目一个字节都不动：`tierName('底力', 'Ⅱ') === '底力'`），
 * 同样，不知道是哪一档（`label` 缺省 / 空串）时也原样返回 —— 不猜档位、不剥标记。
 * 只改**显示**：`data/relicsOverlimitNegative.json` 的 `name` 仍是「破坏力Ⅰ/Ⅱ/Ⅲ」（抽取 / 战斗 / 图鉴读的都是它）。
 * @param {string} name 数据里的 name（卡面 `card.name` / 表里 `entries[].name`）
 * @param {string|null|undefined} label 当前档（`card.tierLabel` / `tiers[].label`）
 * @returns {string}
 */
export function tierName(name, label) {
  const text = typeof name === 'string' ? name : '';
  const lab = typeof label === 'string' ? label.trim() : '';
  const m = TIER_MARK.exec(text);
  if (!m || !lab) return text;
  return `${text.slice(0, m.index)}${lab}`;
}

/**
 * 一条负面词条 → 按档拆好的行（`{ label, text, cur }`）。没有档位（D09…D16B）或表里查不到时返回 null ——
 * 调用方落回「整段 desc」那条老路（一个字节都不变）。
 * @param {any} entry data/relicsOverlimitNegative.json 的一条
 * @param {number|null} [current] 当前这一档（已选面板 = `negPicked[].tier`；三选一 = `card.tierIndex`）
 * @returns {{ label: string, text: string, cur: boolean }[]|null}
 */
export function tierRowsOf(entry, current = null) {
  const tiers = entry && Array.isArray(entry.tiers)
    ? entry.tiers.filter((x) => x && typeof x.label === 'string')
    : [];
  if (!tiers.length) return null;
  const texts = tierTexts(entry.desc, tiers.length);
  const cur = Number.isInteger(current) ? current : null;
  return tiers.map((x, i) => ({ label: x.label, text: texts[i] || '', cur: i === cur }));
}

/** 负面表里按 id 查一条（表还没到货 / 查不到 → null）。 */
function negativeEntryOf(id) {
  if (typeof id !== 'string' || !id) return null;
  return negativeEntries().find((e) => e.id === id) || null;
}

/**
 * 一张卡**当前这一档**的 label（卡片名字也按它显示，见 `tierName`）：优先服务端下发的 `card.tierLabel`
 * （`negativeCardView`），万一没有就用负面表里 `tiers[card.tierIndex].label` 补；都不是（无档位 / 正面饰品 / 表未到货）
 * → null，`tierName` 原样返回名字。
 * @param {any} card sp.cards 的一张
 * @returns {string|null}
 */
function cardTierLabel(card) {
  if (!card || card.negative !== true) return null;
  if (typeof card.tierLabel === 'string' && card.tierLabel) return card.tierLabel;
  const rec = negativeEntryOf(card.id);
  const i = card.tierIndex;
  if (!rec || !Array.isArray(rec.tiers) || !Number.isInteger(i)) return null;
  const tier = rec.tiers[i];
  return tier && typeof tier.label === 'string' ? tier.label : null;
}

/**
 * 三选一卡面要画的档位行：**只有负面词条、且这一张带档位**时才拆（`card.tierLabel` 由服务端
 * `negativeCardView` 下发）。三档的 label / effect 全文从负面表取（卡面自己只带当前那一档的 desc），
 * 表还没到货时至少把**当前这一档**单独画出来（标记 + 卡面文案），不合并成一条。
 * @param {any} card sp.cards 的一张
 */
function cardTierRows(card) {
  if (!card || card.negative !== true || !card.tierLabel) return null;
  const rec = negativeEntryOf(card.id);
  const rows = rec ? tierRowsOf(rec, card.tierIndex) : null;
  if (rows) return rows;
  return [{ label: card.tierLabel, text: typeof card.desc === 'string' ? card.desc : '', cur: true }];
}

/**
 * HUD 用：本局已选词条的 id 列表 → 一整行要画的东西（`m.private.relicsOverlimit.picked` 只有 id；
 * 名字 / 分组 / 图标 / 效果全文在 data/relicsOverlimit.json）。
 * 顺序 = picked 的顺序（服务端按选取顺序记，见 server/match/match/relicDraft.js relicState），查不到的 id 原样回显，
 * 不编名字、不编分组（图标回落占位符，色条用 .zjsel 的默认色）。
 * @param {any[]} entries data/relicsOverlimit.json 的 entries
 * @param {string[]} picked id 列表
 * @returns {{ id: string, name: string, group: string, icon: string|null, desc: string }[]}
 */
export function pickedRelicRows(entries, picked) {
  const byId = new Map((Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  return (Array.isArray(picked) ? picked : []).map((id) => {
    const rec = byId.get(id);
    return {
      id,
      name: rec ? rec.name : id,
      group: rec ? rec.group : '',
      icon: (rec && typeof rec.icon === 'string' ? rec.icon : null),
      desc: (rec && typeof rec.desc === 'string' ? rec.desc : ''),
      tier: null,
      tiers: null,
    };
  });
}

/**
 * 本局已选的**负面**词条 → 面板要画的行（与 `pickedRelicRows` 同一形状，多一个档位标记）。
 * `negPicked` 是 `m.private.relicsOverlimit.negPicked`（`{ id, tier }[]`；服务端也可能给纯 id），
 * 分组永远是数据里的 `neg`（警示红）—— 查不到的 id 原样回显、分组留空，不编名字。
 * @param {any[]} entries data/relicsOverlimitNegative.json 的 entries
 * @param {({ id: string, tier?: number|null }|string)[]} negPicked
 * @returns {{ id: string, name: string, group: string, icon: string|null, desc: string, tier: string|null }[]}
 */
export function pickedNegativeRows(entries, negPicked) {
  const byId = new Map((Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const list = Array.isArray(negPicked) ? negPicked : [];
  return list.map((it) => {
    const id = typeof it === 'string' ? it : (it && it.id);
    const tierIdx = typeof it === 'object' && it && Number.isInteger(it.tier) ? it.tier : null;
    const rec = byId.get(id);
    const tier = rec && Array.isArray(rec.tiers) && tierIdx != null && rec.tiers[tierIdx] ? rec.tiers[tierIdx].label : null;
    return {
      id,
      // 名称按**它实际所在的档**显示（业主 2026-11-01）：`negPicked[].tier` → `tiers[].label`，数据里的
      // 「破坏力Ⅰ/Ⅱ/Ⅲ」在这里变成「破坏力Ⅰ」/「破坏力Ⅱ」；无档位 / 查不到的 id 由 `tierName` 原样返回。
      // 行 `title` 用的也是这个 name ⇒ 悬停也不会再出现「Ⅰ/Ⅱ/Ⅲ」。
      name: tierName(rec ? rec.name : id, tier),
      group: rec ? rec.group : '',
      icon: (rec && typeof rec.icon === 'string' ? rec.icon : null),
      desc: (rec && typeof rec.desc === 'string' ? rec.desc : ''),
      tier,
      // 带档位的负面词条：面板里也**按档拆行**（Ⅰ/Ⅱ/Ⅲ 各自一条 effect），当前拥有的那一档 is-cur；
      // 没有档位的条目 tiers = null → 面板画整段 desc。
      tiers: rec ? tierRowsOf(rec, tierIdx) : null,
    };
  }).filter((r) => typeof r.id === 'string' && r.id);
}

/**
 * 本局已选词条（`m.private.relicsOverlimit`，形状 `{ picked, negPicked, pool, negPool, nextAt, nextNegAt }`，
 * server/match/match/relicDraft.js）。
 * **只有超限局有这个键**：服务端在 server/match/player/views.js 用 `Match.isInfinite`
 * （= shared/infiniteMode.js 的 `isInfiniteMode(room.mode)`，即 `solo_infinite` / `coop_infinite`）门控它，
 * 普通 / 湮灭 / 炸惊的私有视图里没有 ⇒ screens/game.js 的「词条」键与面板只认这个键，其它模式一帧不变。
 * `negPicked`（负面词条，业主 2026-10-31 第二批）缺省 / 形状不对时按空数组走。
 * @param {any} priv m.private
 * @returns {{ picked: string[], negPicked: { id: string, tier: number|null }[] }|null} null = 这一局没有词条（按钮与面板都不画）
 */
export function overlimitRelicsOf(priv) {
  const st = priv && typeof priv === 'object' ? priv.relicsOverlimit : null;
  if (!st || typeof st !== 'object') return null;
  const neg = Array.isArray(st.negPicked) ? st.negPicked : [];
  return {
    ...st,
    picked: Array.isArray(st.picked) ? st.picked.filter((id) => typeof id === 'string' && id) : [],
    negPicked: neg
      .map((x) => (typeof x === 'string' ? { id: x, tier: null } : (x && typeof x.id === 'string' ? { id: x.id, tier: Number.isInteger(x.tier) ? x.tier : null } : null)))
      .filter((x) => x && x.id),
  };
}

/**
 * 已选词条面板的纯视图 —— **照抄炸惊「已选惊变」面板的壳与行**：外壳 .zjpanel / .zjpanel__head / .zjpanel__body、
 * 列表 .zjpanel__grid、行 .zjsel 全部来自 css/screens/jibian.css，尺寸与 --zj-u 的缩放一起继承；
 * 只多一条「分组色条」：.zjsel::before 那根 3px 竖条的颜色由 `--zj-r` 决定，这里按 `data-group` 覆写
 * （颜色与词条三选一的卡面同一套，见 css/screens/overlimitRelics.css）。
 * 一行 = 图标（`icon`，缺失 / 加载失败都落回 GIcon 占位）+ 词条名 + 编号 + **effect 全文** + 分组色条；整行 title 也拼全文。
 * **effect 全文从 2026-11-01 起真的画在行里**（业主：「点开看已选只看到名字 / 图标，看不到效果」）：.zjsel__desc
 * 走 RichText（与三选一卡面同一份 desc 文案、同一套 [灼燃爆发] 之类的富文本），并覆写掉 jibian.css 的两行省略号
 * —— 换行到底，不截断（css/screens/overlimitRelics.css）。带档位的负面词条不画合并 desc，而是按档拆成
 * Ⅰ/Ⅱ/Ⅲ 三行（档位标记 + 各自 effect，`tierRowsOf`），玩家拥有的那一档 is-cur，其余两档压暗但照旧可读。
 * **负面词条列在同一块列表里**（业主 2026-10-31 第二批；「另加一段」业主未定，先按同一面板 + 分组色区分做）：
 * 顺序 = 饰品（picked 顺序）在前、负面（negPicked 顺序）在后；负面行的色条是 `neg`（警示红）。档位（Ⅰ/Ⅱ/Ⅲ）不再
 * 单独画一枚小片：名字已经带当前档（`tierName`），档位只留在分档三行的行首标记上（业主 2026-11-01 收尾口径，
 * 原来的 `.zjsel__tier` 已撤掉）。抬头是**两枚合计**（业主 2026-11-02：一左一右、一蓝一红，与左下角那颗键的
 * 双色角标同一套颜色、同一套零值规则）：蓝 = 正面条数（`picked` 的行数），红 = 负面条数（`negPicked` 的行数），
 * 某侧为 0 就不画那一枚（两侧都 0 时抬头只剩眉题 + 标题，与角标在 0 条时不画是同一个取舍）。两数之和仍是列表行数
 * （一条已选算一行，档位拆的是**行内**的显示，不改已选条数）。原来那枚单数合计 `overlimit-relic-total` 已按
 * 「两个 testid」方案换成 `overlimit-relic-total-pos` / `overlimit-relic-total-neg`（测试同步）。
 * 空态用 msgid `t('还没有选过词条')`（业主 2026-10-31 定稿；之前借用的是 `t('无')`）。
 * @param {{ picked?: string[], negPicked?: ({ id: string, tier?: number|null }|string)[], onClose?: () => void }} props
 */
export function OverlimitRelicPanelView({ picked = [], negPicked = [], onClose = () => {} }) {
  ensureRelicCss();
  const positive = pickedRelicRows(relicEntries(), picked);
  const negative = pickedNegativeRows(negativeEntries(), negPicked);
  const rows = [...positive, ...negative];
  return html`<div class="zjpanel zjpanel--relics" role="dialog" aria-modal="false" aria-label=${t('词条')}
      data-testid="overlimit-relic-panel">
    <div class="zjpanel__scrim" onClick=${onClose}></div>
    <div class="zjpanel__box">
      <header class="zjpanel__head">
        <span class="zjpanel__micro">OVERLIMIT // RELICS</span>
        <b class="zjpanel__title">${t('词条')}</b>
        ${positive.length || negative.length ? html`<span class="zjcodex__totals">
          ${positive.length ? html`<b class="zjcodex__total zjcodex__total--pos num" data-testid="overlimit-relic-total-pos">${positive.length}</b>` : null}
          ${negative.length ? html`<b class="zjcodex__total zjcodex__total--neg num" data-testid="overlimit-relic-total-neg">${negative.length}</b>` : null}
        </span>` : null}
        <button type="button" class="zjpanel__x" aria-label=${t('关闭')} title=${t('关闭')}
          data-testid="overlimit-relic-close" onClick=${onClose}><${Icon} name="close" /></button>
      </header>
      <div class="zjpanel__body">
        ${rows.length
          ? html`<div class="zjpanel__grid" data-testid="overlimit-relic-list">${rows.map((r) => html`<div key=${r.id}
              class=${cx('zjsel', r.group === 'neg' && 'zjsel--neg')} data-group=${r.group || null} data-testid="overlimit-relic-row"
              title=${[r.name, r.id, r.desc].filter(Boolean).join('\n')}>
              <span class="zjsel__icon"><${Img} src=${r.icon} fallback=${html`<${GIcon} name="bolt" />`} /></span>
              <div class="zjsel__main">
                <span class="zjsel__head">
                  <b class="zjsel__name">${r.name}</b>
                  <span class="zjsel__rarity num">${r.id}</span>
                </span>
                ${r.tiers
                  ? html`<div class="zjsel__tiers" data-testid="overlimit-relic-tiers">${r.tiers.map((x) => html`<span key=${x.label}
                      class=${cx('zjsel__tierline', x.cur && 'is-cur')} data-cur=${x.cur ? 'true' : null}>
                      <i class="zjsel__tierlab num">${x.label}</i><${RichText} text=${x.text} /></span>`)}</div>`
                  : html`<${RichText} text=${r.desc || ''} class="zjsel__desc" />`}
              </div>
            </div>`)}</div>`
          : html`<p class="zjpanel__none" data-testid="overlimit-relic-empty">${t('还没有选过词条')}</p>`}
      </div>
    </div>
  </div>`;
}

/**
 * 已选词条面板（带 hooks）：等词条表到货后重画一次 + Esc 关闭；遮罩与右上角 ✕ 走 onClose。
 * 开关状态归 screens/game.js（与炸惊的 JibianHudButton / JibianPanel 同一个分法：按钮只发开合，面板只报关闭）。
 * @param {{ picked?: string[], negPicked?: ({ id: string, tier?: number|null }|string)[], onClose?: () => void }} props
 */
export function OverlimitRelicPanel({ picked = [], negPicked = [], onClose = () => {} }) {
  useData('relicsOverlimit');
  useData('relicsOverlimitNegative');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`<${OverlimitRelicPanelView} picked=${picked} negPicked=${negPicked} onClose=${() => closeRef.current()} />`;
}
