// server/sim/content/kits/ops/op-tocka.js — 冻河 (char_4244_tocka) 自选 operator kit: 6★ 辅助·游击手 (supportiveranger), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots. Every skill, both talents and the trait.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Data: character_table / skill_table of the v79 client (docs/research/26-v79-diy-operators.json), built into
// data/backups.json units.char_4244_tocka; numbers from the record's blackboards at the chess's rank (normal 4, elite 7).
// v79 ships no module for her (`charEquip` empty).
//
// Trait 游击手 "可以使用触发型效果协助作战" — a 触发型效果 is an effect that fires when its holder's condition is met. The sim
// has no such primitive, so the kit builds one out of what the engine already has (方案 ①, the pattern of
// chess_zj_60_4-yukari.js's 镜像 trigger):
//   * the mark is an ORDINARY buff (`tocka:mark`) whose `data` holds the payload. `makeBuff` (buffs.js) copies a fixed
//     whitelist of fields — `data` is on it (buffs.js `data: b.data ?? {}`), a field like `effect` is NOT: that is why
//     the mark's payload used to be dropped and S1's barrier / S2's attack-speed window / S3's ATK window never applied;
//   * the fire condition is an engine hook on the holder (`damaged` / `tick` / `attack`, battle/hooks.js), registered
//     with `{ owner: holder }` — so a holder that leaves the field loses it (the tick releases a removed unit's hooks) —
//     and dropped by the mark's `onRemove`;
//   * the mark removes itself when it fires (触发后自解除): `fireMark` → `removeBuff` → `onRemove` → the listener is gone,
//     one fire per grant.
// `data` layout: { ownerId, kind: 'shield' | 'aspd' | 'atim', …payload }.
//
// - T1 夜的哑然 (sp 2, heal_scale 1 — the P2/P5 candidate, the one the elite rank carries): when a mark she granted fires,
//   she gains `sp` SP and heals the most hurt ally in her attack range for `heal_scale` × her ATK.
// - T2 雪的印痕 (attack@t2_buff_duration 8, attack@t2_magic_atk_scale 0.8, attack@t2_atk −0.2, attack@projectile_range
//   1.5): after a mark of hers fires, her NEXT normal attack splashes — every enemy within the talent's own
//   `attack@projectile_range` of what the attack hit — and its target takes the catalogue's 虚弱 (ba.weaken "攻击力下降
//   相应比例": `applyStatus(target, 'weaken', { value: 0.2 })`, ATK ×0.8) for the duration, each second of which deals
//   `t2_magic_atk_scale` × her ATK arts. The "next normal attack" is the real attack (`attack` hook, `isSkill` false),
//   not a damage-calculation rewrite.
// - S1 一无所有之人 (AUTO, instant, shield_atk_scale, shield_time, stun, max_target): a mark on up to `max_target` allies
//   in range that do not already hold one ("只选择未持有该效果的目标"); "受到攻击时" — an enemy's normal attack lands on
//   the holder → the holder gains a `shield_atk_scale` × 冻河's ATK barrier decaying over `shield_time` s and that
//   attacker is stunned `stun` s.
// - S2 意欲呼啸之心 (AUTO, instant, attack_speed, buff_duration, max_target): a mark on `max_target` allies anywhere
//   ("全场"); "技能可开启时" — the holder's skill becomes ready → +`attack_speed` attack speed for `buff_duration` s, and
//   meanwhile the holder's skill "变为自动开启": its auto-cast rule becomes SP_FULL and is restored when the window ends
//   (the reading of 自动开启 as SP_FULL, as 立石凛's kit: "AUTO skill takes no 技能策略: SP_FULL"). [ASSUMED] that reading;
//   the sim already auto-operates every ready DEFAULT skill, so it only changes a skill whose data rule would wait
//   (TAKE_DAMAGE / MANUAL).
// - S3 踽踽独行之春 (MANUAL, 20 s, attack@max_target, attack@stun, attack@atk_scale, attack_speed, bonus_*): +`attack_speed`
//   attack speed and attacks that hit up to `attack@max_target` enemies for `attack@atk_scale` × ATK physical with an
//   `attack@stun` s stun. "开启技能时自身和冻河攻击力+bonus_init_atk（在 bonus_duration 秒内衰减）": the ATK window (ATK
//   +`bonus_init_atk`, −`bonus_atk_dec_per_sec` per second over `bonus_duration` s) on 冻河, and again on both the holder
//   and 冻河 when the mark fires. "立刻对范围内另一名干员施加触发型效果（已存在时改为将其触发）… 转移给…技力比例最高的另一名干
//   员": the mark goes to the other ally in range with the highest SP ratio — an existing mark is fired instead — and a
//   holder of a mark gains `bonus_sp` SP per second while the skill runs.
// [ASSUMED] the trigger conditions the texts name only for S1 ("受到攻击时" = an enemy's normal attack on the holder) and
// S2 ("技能可开启时" = the holder's skill is ready); S3's text names none for the mark it places, so it fires on the
// holder's next normal attack. Nothing rolls: the mark's target is the deploy order (S1 / S2) or the SP ratio (S3).
//
// fx kinds emitted: mark {id, kind} · shield {id} (engine kind).

import { num, talentBb, skillBbOf, statBuff, giveSp } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_tocka_1';
const S2 = 'skchr_tocka_2';
const S3 = 'skchr_tocka_3';

/** Buff key of the trigger mark (触发型效果) an ally carries; `data` is its payload (see the header). */
const MARK = 'tocka:mark';
/** 雪的印痕's debuffs on the attack's target. */
const TRACE_DOT = 'tocka:trace:dot';
/** 踽踽独行之春's ATK window: the buff, and the stat buff that carries the decaying value. */
const ATK_WINDOW = 'tocka:atk';
const ATK_WINDOW_VALUE = 'tocka:atk:value';
/** 意欲呼啸之心's attack-speed window. */
const ASPD_WINDOW = 'tocka:aspd';

/** Tile key of (row, col) — the engine's PosKey. */
const tk = (r, c) => r * COLS + c;

/**
 * A barrier of `total` HP decaying linearly to 0 over `dur` s — S1's 屏障 "在 shield_time 秒内衰减" (the same reading as
 * 新约能天使's decaying barriers, chess_char_6_13-angel2.js).
 */
function decayingBarrier(battle, holder, total, dur, source) {
  if (!(total > 0)) return null;
  const decays = dur > 0;
  return battle.addBuff(holder, {
    key: 'tocka:shield', shield: total, duration: decays ? dur : Infinity, visible: true, source,
    interval: decays ? 0.5 : 0,
    onTick: decays ? ({ unit, buff }) => { buff.shield = Math.max(0, buff.shield - (total * 0.5) / dur); unit.markDirty(); } : null,
  });
}

/**
 * 踽踽独行之春's ATK window: +`atk` (an `atkPct`) falling by `dec` every second over `dur` s — "攻击力+bonus_init_atk（在
 * bonus_duration 秒内衰减）". The current value sits in its own persistent stat buff so a second window replaces it cleanly
 * and the end of the window takes it away again.
 */
function atkWindow(battle, target, atk, dec, dur, source) {
  if (!target || !target.alive || !(dur > 0) || !(atk > 0)) return null;
  let elapsed = 0;
  const value = (n) => Math.max(0, atk - dec * n);
  const clear = ({ battle: b, unit: u }) => { b.removeBuff(u, ATK_WINDOW_VALUE); };
  statBuff(battle, target, ATK_WINDOW_VALUE, { atkPct: value(0) });
  return battle.addBuff(target, {
    key: ATK_WINDOW, duration: dur, interval: 1, visible: true, source, tags: ['skill', 'talent'],
    onTick: ({ battle: b, unit: u }) => { elapsed++; statBuff(b, u, ATK_WINDOW_VALUE, { atkPct: value(elapsed) }); },
    onExpire: clear, onRemove: clear,
  });
}

/**
 * 意欲呼啸之心's window: +`aspd` attack speed for `dur` s, and meanwhile the holder's skill "变为自动开启" — its auto-cast
 * rule becomes SP_FULL (a ready skill opens at once) and the data's rule comes back when the window ends. The original
 * rule is kept on the holder (`mem.tockaAspdRule`), so a window that replaces another still restores the profile's rule.
 */
function aspdWindow(battle, holder, aspd, dur, source) {
  if (!(dur > 0)) return null;
  const sk = holder.skill;
  const live = !!(sk && !sk.noSkill && sk.kind !== 'passive');
  const prev = holder.mem.tockaAspdRule ?? (live ? { rule: sk.rule, grid: sk.triggerGrid } : null);
  if (prev) {
    holder.mem.tockaAspdRule = prev;
    if (sk.rule !== 'SP_FULL') sk.setTrigger('SP_FULL', null);
  }
  const restore = ({ unit }) => {
    const p = unit.mem.tockaAspdRule;
    const s = unit.skill;
    unit.mem.tockaAspdRule = null;
    if (p && s && s.rule === 'SP_FULL') s.setTrigger(p.rule, p.grid);
    const off = unit.mem.tockaAspdOff;
    unit.mem.tockaAspdOff = null;   // a later window on this holder registers its own
    if (off) battle.off(off);
  };
  if (prev && !holder.mem.tockaAspdOff) {
    // a unit that leaves the field loses its non-persistent buffs without `onRemove` (battle/deploy.js wipes them):
    // put the data's rule back then too, so a knock-out inside the window cannot leave SP_FULL behind.
    holder.mem.tockaAspdOff = battle.on('death', ({ unit }) => { if (unit === holder) restore({ unit: holder }); }, { owner: holder });
  }
  return battle.addBuff(holder, {
    key: ASPD_WINDOW, duration: dur, mods: { aspd }, visible: true, source, tags: ['skill', 'talent'],
    onExpire: restore, onRemove: restore,
  });
}

export default {
  char_4244_tocka: (bb, chess) => {
    const t1 = talentBb(chess, 0); // 夜的哑然
    const t2 = talentBb(chess, 1); // 雪的印痕
    const b1 = skillBbOf(chess, S1);
    const b2 = skillBbOf(chess, S2);
    const b3 = skillBbOf(chess, S3);

    /** 冻河's talent handlers — every mark she granted that fires calls them (kept on the unit: per-battle by nature). */
    const fireHooks = (unit) => (unit.mem.tockaFire ??= []);

    /**
     * Deployed allies on a tile of `unit`'s current attack range (`unit.rangeKeys` is an array — the Set is
     * `rangeKeySet`; devices and 孤立 allies are excluded by alliesFor).
     */
    const alliesInRange = (battle, unit) => {
      const set = unit.rangeKeySet || new Set(unit.rangeKeys || []);
      return battle.alliesFor(unit).filter((a) => a && a.alive && a.deployed && set.has(tk(Math.round(a.y), Math.round(a.x))));
    };

    /**
     * The candidates of a mark, in the order the skills take them: the other allies first (deploy order), 冻河 last —
     * the trait is "可以使用触发型效果协助作战" and the official game picks its target at random among them; the sim takes
     * the deploy order instead ([ASSUMED]) and prefers another operator, so S2's single mark does not always land on her.
     */
    const markOrder = (list, unit) => list.slice().sort((a, b) => (a === unit ? 1 : 0) - (b === unit ? 1 : 0));

    /**
     * Fire the mark `holder` carries: its payload takes effect, the mark removes itself (触发后自解除 — `onRemove` drops
     * its listener) and 冻河's talents hear about it. `ctx` is the event that fired it (S1 needs its attacker). Returns
     * the payload, or null when the holder carries no mark.
     */
    const fireMark = (battle, unit, holder, ctx) => {
      const buff = holder && holder.findBuff ? holder.findBuff(MARK) : null;
      if (!buff) return null;
      const d = buff.data || {};
      battle.removeBuff(holder, buff);
      if (d.kind === 'shield') {
        // "获得相当于冻河 shield_atk_scale 攻击力的屏障（在 shield_time 秒内衰减），并使攻击者晕眩 stun 秒"
        decayingBarrier(battle, holder, unit.s.atk * num(d.scale), num(d.time, 10), unit);
        battle.fx('shield', { x: holder.x, y: holder.y, id: holder.id });
        const attacker = ctx && ctx.source;
        const stun = num(d.stun);
        if (stun > 0 && attacker && attacker.alive && attacker.side === 'enemy') battle.applyStatus(attacker, 'stun', { duration: stun, source: unit });
      } else if (d.kind === 'aspd') {
        aspdWindow(battle, holder, num(d.aspd), num(d.duration, 15), unit);
        battle.fx('buff', { x: holder.x, y: holder.y, id: holder.id, kind: 'tocka' });
      } else if (d.kind === 'atim') {
        // "开启技能时自身和冻河攻击力+bonus_init_atk（在 bonus_duration 秒内衰减）": the holder ("自身") and 冻河
        atkWindow(battle, holder, num(d.atk), num(d.dec), num(d.duration, 15), unit);
        if (unit.alive) atkWindow(battle, unit, num(d.atk), num(d.dec), num(d.duration, 15), holder);
        battle.fx('buff', { x: holder.x, y: holder.y, id: holder.id, kind: 'tocka' });
      }
      for (const fn of unit.mem.tockaFire || []) fn(holder);
      return d;
    };

    /**
     * The listener of a mark's fire condition — one per kind, the condition its skill's text names:
     * 'shield' = S1's "受到攻击时" (an enemy's normal attack lands on the holder), 'aspd' = S2's "技能可开启时" (the
     * holder's skill becomes ready; SP is the only way up, read on the tick hook because the engine's `spGain` fires
     * before the SP lands), 'atim' = the holder's next normal attack ([ASSUMED]: S3's text names no condition for the
     * mark it places). Owned by the holder, so it goes away with the holder.
     */
    const wire = (battle, unit, holder, kind) => {
      const fire = (ctx) => { if (holder.alive && holder.deployed) fireMark(battle, unit, holder, ctx); };
      if (kind === 'shield') {
        return [battle.on('damaged', (c) => {
          if (c.target !== holder || !c.dmg || !c.dmg.isAttack) return;
          if (!c.source || c.source.side !== 'enemy') return;
          fire(c);
        }, { owner: holder })];
      }
      if (kind === 'aspd') {
        // "技能可开启时": SP is the only way a skill becomes ready, but the engine's `spGain` fires BEFORE the SP lands
        // (skills.js gainSp emits, then adds), so the condition is read on the tick hook.
        return [battle.on('tick', () => { if (holder.skill && holder.skill.ready) fire(null); }, { owner: holder })];
      }
      return [battle.on('attack', (c) => { if (c.attacker === holder && !c.isSkill) fire(c); }, { owner: holder })];
    };

    /**
     * Put a mark on `holder` unless it already holds one ("只选择未持有该效果的目标"), and wire its fire condition.
     * Returns true when placed.
     */
    const mark = (battle, unit, holder, payload) => {
      if (!holder || !holder.alive || !holder.deployed) return false;
      if (holder.findBuff && holder.findBuff(MARK)) return false;
      const buff = battle.addBuff(holder, {
        key: MARK, source: unit, persist: true, visible: true, tags: ['skill', MARK],
        data: { ownerId: unit.id, ...payload },
        onRemove: ({ buff: b }) => { if (b.tockaOff) b.tockaOff(); },
      });
      if (!buff) return false;
      const handles = wire(battle, unit, holder, payload.kind);
      buff.tockaOff = () => { for (const h of handles) battle.off(h); };
      battle.fx('mark', { x: holder.x, y: holder.y, id: holder.id, kind: 'tocka' });
      return true;
    };

    return {
      talents: [
        { install(battle, unit) { // 夜的哑然
          const sp = num(t1.sp), healScale = num(t1.heal_scale);
          fireHooks(unit).push((holder) => {
            void holder;
            if (!unit.alive) return;
            if (sp > 0) giveSp(unit, sp, 'talent');
            if (!(healScale > 0)) return;
            const hurt = alliesInRange(battle, unit).filter((a) => a.hp < a.s.maxHp);
            if (!hurt.length) return;
            hurt.sort((a, b) => a.hpRatio - b.hpRatio || a.id - b.id);
            battle.heal({ source: unit, target: hurt[0], amount: unit.s.atk * healScale });
          });
        } },
        { install(battle, unit) { // 雪的印痕
          const dur = num(t2['attack@t2_buff_duration'], 6);
          const scale = num(t2['attack@t2_magic_atk_scale']);
          const weak = Math.abs(num(t2['attack@t2_atk']));
          const radius = Math.max(0, num(t2['attack@projectile_range'], 1.5));
          // "施加触发型效果后的下次普通攻击": a mark of hers firing arms her next normal attack
          fireHooks(unit).push(() => { if (dur > 0) unit.mem.tockaTrace = true; });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || c.isSkill || !unit.mem.tockaTrace || !unit.alive) return;
            unit.mem.tockaTrace = false;
            const type = (unit.profile && unit.profile.dmgType) || 'phys';
            for (const target of c.targets || []) {
              if (!target || !target.alive || target.side !== 'enemy') continue;
              // 范围伤害: every other enemy inside the talent's own `attack@projectile_range` of what the attack hit
              for (const e of battle.foesInRadius(target.x, target.y, radius)) {
                if (e === target || !e.alive) continue;
                battle.dealDamage({ source: unit, target: e, amount: unit.s.atk, type, isAttack: true, isSplash: true, tags: ['talent', 'tocka:trace'] });
              }
              // 20 % 虚弱 (ba.weaken: ATK down by that share) for `dur` s, 80 % of her ATK as arts every second of it
              if (weak > 0) battle.applyStatus(target, 'weaken', { value: weak, duration: dur, source: unit });
              if (scale > 0 && target.alive) battle.addBuff(target, {
                key: TRACE_DOT, duration: dur, interval: 1, visible: true, source: unit, tags: ['talent'],
                onTick: ({ battle: b }) => {
                  if (!target.alive || !target.deployed) return;
                  b.dealDamage({ source: unit, target, amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'tocka:trace'] });
                },
              });
            }
          }, { owner: unit });
        } },
      ],
      skills: {
        [S1]: { // 一无所有之人
          kind: 'instant',
          onStart({ battle, unit }) {
            const max = Math.max(1, Math.floor(num(b1.max_target, 1)));
            const payload = { kind: 'shield', scale: num(b1.shield_atk_scale), time: num(b1.shield_time, 10), stun: num(b1.stun) };
            let n = 0;
            for (const a of markOrder(alliesInRange(battle, unit), unit)) { if (n >= max) break; if (mark(battle, unit, a, payload)) n++; }
          },
        },
        [S2]: { // 意欲呼啸之心
          kind: 'instant',
          onStart({ battle, unit }) {
            const max = Math.max(1, Math.floor(num(b2.max_target, 1)));
            const payload = { kind: 'aspd', aspd: num(b2.attack_speed), duration: num(b2.buff_duration, 15) };
            let n = 0;
            for (const a of markOrder(battle.alliesFor(unit), unit)) {
              if (n >= max) break;
              if (!a || !a.alive || !a.deployed) continue;
              if (!mark(battle, unit, a, payload)) continue;
              n++;
              // "技能可开启时": a holder whose skill is ready already satisfies the condition — it fires now
              if (a.skill && a.skill.ready) fireMark(battle, unit, a, null);
            }
          },
        },
        [S3]: { // 踽踽独行之春
          kind: 'duration', duration: 20,
          mods: { aspd: num(b3.attack_speed) },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1), maxTargets: Math.max(1, num(b3['attack@max_target'], 1)),
            onHit({ battle, unit, target }) {
              const stun = num(b3['attack@stun']);
              if (target && target.side === 'enemy' && stun > 0) battle.applyStatus(target, 'stun', { duration: stun, source: unit });
            },
          },
          onStart({ battle, unit }) {
            // "开启技能时自身和冻河攻击力+bonus_init_atk（在 bonus_duration 秒内衰减）" — on 冻河, the caster of both readings
            const atk = num(b3.bonus_init_atk), dec = num(b3.bonus_atk_dec_per_sec), dur = num(b3.bonus_duration, 15);
            atkWindow(battle, unit, atk, dec, dur, unit);
            // "立刻对范围内另一名干员施加触发型效果（已存在时改为将其触发）… 转移给…技力比例最高的另一名干员"
            const mates = alliesInRange(battle, unit).filter((a) => a !== unit);
            const spRatio = (a) => (a.skill && a.skill.spCost > 0 ? Math.min(1, a.skill.sp / a.skill.spCost) : 0);
            mates.sort((a, b) => spRatio(b) - spRatio(a) || a.id - b.id);
            const holder = mates.find((a) => a.findBuff && a.findBuff(MARK));
            if (holder) fireMark(battle, unit, holder, null);
            else if (mates.length) mark(battle, unit, mates[0], { kind: 'atim', atk, dec, duration: dur });
            // "冻河技能期间拥有该效果的干员每秒获得 bonus_sp 点技力"
            const sp = num(b3.bonus_sp);
            if (sp > 0) battle.addBuff(unit, {
              key: 'tocka:sp', duration: 20, interval: 1, tags: ['skill'],
              onTick: ({ battle: b }) => { for (const a of alliesInRange(b, unit)) if (a.findBuff && a.findBuff(MARK)) giveSp(a, sp, 'talent'); },
            });
          },
        },
      },
    };
  },
};
