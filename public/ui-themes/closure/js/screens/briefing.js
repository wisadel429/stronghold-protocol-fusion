// Briefing — INFO_CHECK "1/2 确认本局信息" (research 06 §4.1, D1): enemy leader (portrait, name, round, abilities),
// stage (+ its pool: 战场固定 / 战场随机（共N张）), 特训敌人 factions (icon, name; the description in the tooltip), the ready
// count x/N with person pips, the 准备就绪 button (g.infoReady) and the countdown. The bond rows, the legend and the
// 本局禁用干员 avatars, with the player's own 自选 pieces out of the shop (m.private.diyBanned), are ui/matchInfo.js — the
// same blocks the strategy draft's 本局信息 dialog shows (screens/bandDraft.js).
// 2026-11-11: original screenshot layout — scrolling bond / banned-operator sections on the left; battlefield
// thumbnail, leader and faction rows on the right. Grey header art, grouped roster exclusions, ready actions and
// existing section entry animations are shared by the original and Closure builds.

import { useState } from '/vendor/hooks.module.js';
import { html, Button, Icon, Tooltip } from '/js/ui/components.js';
import { useGameData, Img, RichText } from '/js/ui/gameComponents.js';
import { StagePreview, StagePreviewDialog } from '/js/ui/stagePreview.js';
import { StepHeader, ExitModal } from '/js/ui/matchChrome.js';
import { MatchBondRow, BannedOperators, matchInfoModel } from '/js/ui/matchInfo.js';
import { LoadoutButton } from '/js/screens/loadout.js';
import { UnofficialMark } from '/js/ui/pluginTag.js';
import { SetupReroll } from '/js/ui/setupReroll.js';
import { actions } from '/js/ui/gameActions.js';
import { factionTypes, sortedPlayers, phaseTotalSeconds } from '/js/ui/gameLogic.js';
// 官方 / 炸惊 / 湮灭 三态的盟约过滤（与原版 briefing 同一口径）：官方局不列 zjOnly / annOnly 的专属盟约
import { officialBonds } from '/js/ui/zjView.js';
import { enemyIconUrl, factionIconUrl } from '/js/ui/assetUrls.js';
import { useStore } from '/js/store.js';
import { RANDOM_MODE, RANDOM_MODE_NAME } from '/shared/randomMode.js';
import { data } from '/js/data.js';
import { t } from '/shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** INFO_CHECK screen. */
export function BriefingScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const solo = useStore((s) => s.room?.mode === 'solo') || String(pub?.modeId || '').includes('single');
  // gameplay plugins (DESIGN §32.6): the briefing says the match is unofficial
  const room = useStore((s) => s.room);
  const gd = useGameData();
  const [exit, setExit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  if (!pub) return null;

  const players = sortedPlayers(pub);
  const me = players.find((p) => p.playerId === myId);
  const readyN = players.filter((p) => p.ready).length;
  const mode = gd.config?.modes?.[pub.modeId];
  // (+ the own 自选 pieces this match leaves out of the shop: m.private.diyBanned)
  // 业主 2026-11-18「常规游戏不应出现 SEES 和颂乐人偶盟约」：主题包这版 briefing 直接拿 `gd.list('bonds')`（全量，
  // 含 zjOnly 的炸惊专属盟约），而主机版走 `officialBonds(...)` 过滤。这里补上同一道过滤（三态：官方 / 炸惊 / 湮灭）。
  const info = matchInfoModel(pub, { bonds: officialBonds(gd.list('bonds'), pub?.modeId ?? pub?.difficulty), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } });
  const boss = pub.bossId ? gd.boss(pub.bossId) : null;
  const bossEnemy = boss ? gd.enemy(boss.enemyKey) : null;
  const stage = pub.stageId ? gd.stage(pub.stageId) : null;
  // the mode's battlefield pool (config.json modes[].stages): 标准 is always 战场#01, 险境+ draw one at random
  const poolN = Array.isArray(mode?.stages) ? mode.stages.length : 0;
  const pool = poolN > 1 ? t('战场随机（共{poolN}张）', { poolN }) : poolN === 1 ? t('战场固定') : '';
  const types = factionTypes(pub.factions);
  const factions = gd.factions?.types || {};
  const m = gd.m;
  const bossRound = (pub.randomMode ? pub.lastRound ?? mode?.bossRound : mode?.bossRound ?? pub.lastRound) ?? 14;

  const ready = async () => {
    if (busy || me?.ready) return;
    setBusy(true);
    try { await actions.infoReady(pub.setupRevision ?? 0); }
    finally { setBusy(false); }
  };

  return html`<div class="screen brief brief--split">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${1} of=${2} title=${t('确认本局信息')} micro="BRIEFING // INFO CHECK" pub=${pub}
      total=${phaseTotalSeconds(pub, gd.config)} onExit=${() => setExit(true)} />
    <${UnofficialMark} room=${room} class="brief__modmark" />
    <main class="brief__main">
      <div class="brief__bonds-column">
      ${pub.randomMode ? html`<div class="brief-fire" data-testid="brief-firepower" style="--i:0">
        <b>${RANDOM_MODE_NAME}${pub.variant === 'endurance' ? t(' · 持久鏖战') : t(' · 快速突袭')}</b>
        <span>干员生命 ×${RANDOM_MODE.multipliers.allyHp}、攻击 ×${RANDOM_MODE.multipliers.allyAtk}、防御 ×${RANDOM_MODE.multipliers.allyDef}；技力恢复加速 ${Math.round((RANDOM_MODE.firepower.spRecoveryMul - 1) * 100)}%（保留原生技能轴），再部署缩短 ${Math.round((1 - RANDOM_MODE.firepower.redeployMul) * 100)}%，部署上限 9 人。${(pub.variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : RANDOM_MODE.totalRounds)} 回合轻松乱斗，保持防线迎战复合怪潮与悬赏 BOSS；终局领袖关卡 ${RANDOM_MODE.finalLevel.seconds} 秒限时。</span>
      </div>` : null}

      <section class="brief-sec brief-sec--core" style="--i:2"><${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${info.core} model=${info} /></section>
      <section class="brief-sec brief-sec--addon" style="--i:3">
        <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${info.addon} model=${info} compactLegend=${true} />
      </section>
      <section class="brief-sec brief-sec--banned" style="--i:4"><${BannedOperators} model=${info} grouped=${true} /></section>
      </div>
      <aside class="brief__enemy-column brief-sec" style="--i:1" aria-label=${t('本局遭遇敌方')}>
        <${StagePreview} stageId=${pub.stageId} name=${stage?.name} pool=${pool} onOpen=${() => setMapOpen(true)} />
        <div class="brief-enemy">
          <div class="brief-boss">
            <div class="brief-boss__art">
              ${bossEnemy ? html`<${Img} src=${enemyIconUrl(m, boss.enemyKey)} class="brief-boss__img" fallback=${html`<span class="brief-boss__q">?</span>`} />`
                : html`<span class="brief-boss__q">?</span>`}
            </div>
          </div>
          <div class="brief-boss__text">
            <span class="brief-boss__tag">${t('敌方领袖')}</span>
            <h2 class="brief-boss__name">${boss?.name || bossEnemy?.name || t('未知领袖')}</h2>
            <${Tooltip} text=${Array.isArray(boss?.abilities) && boss.abilities.length ? html`<ul class="brief-boss__abil">
              ${boss.abilities.slice(0, 3).map((a, i) => html`<li key=${i}><${RichText} text=${a} /></li>`)}
            </ul>` : null}><span class="brief-boss__when" tabindex="0">${t('第 {n} 回合 · 最终攻势', { n: bossRound })}</span><//>

          </div>
          <div class="brief-factions">
            ${types.length ? types.map((ty) => html`<${Tooltip} key=${ty} text=${factions[ty]?.desc || null}>
              <div class="brief-faction" tabindex="0">
                <span class="brief-faction__icon"><${Img} src=${factionIconUrl(m, factions[ty]?.icon)} /></span>
                <b class="brief-faction__name">${factions[ty]?.name || ty}</b>
              </div>
            <//>`) : html`<p class="t-dim">${t('本局没有特训敌人')}</p>`}
          </div>
        </div>
      </aside>

    </main>
    <${SetupReroll} pub=${pub} />
    <footer class="brief__foot">
      <${LoadoutButton} from="briefing" size="lg" class="brief-loadout" />
      <div class="brief-ready">
        <span class="brief-ready__txt">${t('已就绪')}:<b class="num">${readyN}</b><span class="num">/${players.length}</span></span>
        <span class=${cx('brief-ready__pips', players.length > 4 && 'is-many')}>${players.length > 4
          ? html`<i class=${cx(readyN > 0 && 'on')} title=${players.map((p) => p.name).join(' / ')}><${Icon} name="user" /></i><b class="brief-ready__x num">×${players.length}</b>`
          : players.map((p) => html`<i key=${p.playerId} class=${cx(p.ready && 'on', p.playerId === myId && 'me')} title=${p.name}><${Icon} name="user" /></i>`)}</span>
      </div>
      <${Button} variant="primary" size="xl" class="brief-go" icon=${me?.ready ? 'check' : me ? 'play' : 'eye'} active=${!!me?.ready} loading=${busy}
        disabled=${!!me?.ready || !me || !!pub.rerollVote} onClick=${ready}>${me?.ready ? t('已就绪') : me ? t('准备就绪') : t('观战中')}<//>
    </footer>
    ${mapOpen ? html`<${StagePreviewDialog} key=${pub.stageId} stageId=${pub.stageId} name=${stage?.name} onClose=${() => setMapOpen(false)} />` : null}
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
  </div>`;
}
