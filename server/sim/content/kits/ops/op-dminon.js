// server/sim/content/kits/ops/op-dminon.js — 国度 (char_4246_dminon) 自选 operator kit: 6★ 特种·伏击客 (stalker), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots. Every skill, both talents and the trait.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Data: character_table / skill_table of the v79 client (docs/research/26-v79-diy-operators.json), built into
// data/backups.json units.char_4246_dminon; numbers from the record's blackboards at the chess's rank (normal 4, elite 7).
// v79 ships no module for her (`charEquip` empty).
//
// Trait 伏击客 "对攻击范围内所有敌人造成伤害 / 拥有50%的物理和法术闪避且不容易成为敌人的攻击目标" is the profession
// default (professions.js SUB.stalker: allInRange, dodge from the trait's `prob`, taunt −1) — no override here.
//
// 「国度」 is the operator's own attack range (T1: "自身攻击范围内弥漫“国度”"), so every 国度 rule below reads
// `unit.rangeKeys` — it follows her when she is redeployed and it grows while a range-changing skill runs.
//
// - T1 实质坍缩 (attack_speed, atk_scale): a ground enemy standing in 国度 has its attack speed −`attack_speed` and takes
//   `atk_scale` × ATK arts every second.
// - T2 此身为界 (atk_scale, stun): when she leaves the field (撤退 / 被击倒 — the `death` hook) every ground enemy in
//   国度 takes `atk_scale` × ATK arts and is stunned `stun` s, then the 国度 is gone (it follows her body, so nothing is
//   left to clean up). [ASSUMED] the retreat and the knock-out share one event in this sim.
// - S1 停步 (duration 20 s, attack_speed, sluggish): +`attack_speed` attack speed; "每个敌人首次踏上“国度”时会停顿
//   <sluggish> 秒" — 停顿 is the engine's catalogue status `sluggish` (buffs.js STATUS "停顿 (sluggish): −80 % move speed", in
//   RESIST_STATUSES, so 抵抗 shortens it and an enemy immune to 停顿 refuses it: content/enemies.js beforeStatus), applied as
//   `battle.applyStatus(e, 'sluggish', { duration, source })` like 灵知 / 提丰 / 洛洛 do; the length is the blackboard's
//   (`sluggish`: 3 s at rank 4, 4 s at rank 7), never a literal. "首次踏上" is read as the first time during one use of the
//   skill that an enemy's body is in the 国度 (body.js bodyInRange against her live range keys — the 国度 follows her, so
//   S2 / S3's widened range counts too) [ASSUMED: a per-use set of enemy ids; an enemy already standing in it when the
//   skill starts counts as having stepped on it, and a 隐匿 one is affected too, since a zone rule selects nobody].
// - S2 受戮 (duration 20 s, atk, attack_speed, its own 技能范围 y-3): the range widens to the skill's own range grid, ATK
//   +`atk`, attack speed +`attack_speed`, and "使“国度”上的敌人无法闪避物理和法术攻击": while it runs, a `hit` hook gives
//   every physical / arts damage instance aimed at an enemy whose body is in the 国度 `dmg.dodgeMode = 'ignore'` — the
//   engine's own 无视闪避 channel (attack/helpers.js damageDodgeMode, read after the `hit` hooks; 鸿雪 ARC-Y "无视其物理
//   闪避", 超限模拟 FGO-08/16), so an enemy's dodgePhys / dodgeArts roll — a boss's `evade` buff, an aura, a status —
//   never fires. [ASSUMED] every phys / arts instance, not only "attacks" (the engine's dodge is per damage type, not per
//   attack); the test is positional, so an air unit over a 国度 tile is covered. From the second use on it also adds
//   +`attack_speed` again and lasts forever ("第二次及以后使用时额外使攻击速度+30，且持续时间无限") — [ASSUMED] the
//   infinite part is expressed as the 20 s skill plus a persistent attack-speed buff, so this use's wider 国度 and its
//   无法闪避 half end with the skill.
// - S3 无人的国度 (duration 36 s, atk, attack_speed, attack@aoe_atk_scale, attack@cd, its own 技能范围 y-10): the range
//   widens to the skill's grid, ATK +`atk`, attack speed +`attack_speed`, every enemy on 国度 is attacked at once
//   (`allInRange`); while an ally standing on 国度 is attacked, 国度 spreads around the attacker and deals
//   `attack@aoe_atk_scale` × ATK physical to it, at most once per `attack@cd` s; the 国度 resets when the skill ends.
//   [ASSUMED] "单位被地面敌人攻击时" is read as "an enemy's attack lands on an ally in 国度" (the sim gives the hit no
//   attacker identity to spread from, so the spread is centred on the victim's tile).

import { num, talentBb, skillBbOf, skillRec, statBuff, up } from '../shared/tier1.js';
import { bodyInRange } from '../../../body.js';
import { COLS } from '../../../constants.js';

/** Tile key of (row, col) — the engine's PosKey. */
const tk = (r, c) => r * COLS + c;

const S1 = 'skchr_dminon_1';
const S2 = 'skchr_dminon_2';
const S3 = 'skchr_dminon_3';

/** Every 1 s: the 国度's slow and its arts tick, over her live attack range. */
const NATION_TICK = 1;

/**
 * Is enemy `e` on the 国度? The zone is her live attack range (`unit.rangeKeys`), and membership is the body test the
 * engine uses for a range (body.js bodyInRange: the 0.1 collider, a huge enemy's rectangle) — the same test 阿斯卡纶's S3
 * 命中率 and every kit aura use. Positional, so it neither asks the attack selectors (a 隐匿 enemy is on it too) nor the
 * trait's own ground-only profile.
 */
const inNation = (unit, e) => !!(e && e.alive && unit.rangeKeySet && bodyInRange(e, unit.rangeKeySet));
/** Is her 受戮 running? */
const s2On = (u) => !!(u.skill && u.skill.active && u.skill.id === S2);

export default {
  char_4246_dminon: (bb, chess) => {
    const t1 = talentBb(chess, 0);
    const t2 = talentBb(chess, 1);
    const b1 = skillBbOf(chess, S1);
    const b2 = skillBbOf(chess, S2);
    const b3 = skillBbOf(chess, S3);
    const r2 = skillRec(chess, S2);
    const r3 = skillRec(chess, S3);
    const slow = num(t1.attack_speed);
    const dot = num(t1.atk_scale);
    /** 停顿 length of 停步 (bb `sluggish`: 3 s at rank 4, 4 s at rank 7). */
    const stopFor = num(b1.sluggish);
    const picked = chess?.skill?.skillId ?? null;
    return {
      talents: [
        { install(battle, unit) { // 实质坍缩 — the 国度 itself
          if (!(slow !== 0 || dot > 0)) return;
          battle.addBuff(unit, {
            key: 'dminon:nation', interval: NATION_TICK, persist: true, allowDead: true, tags: ['talent'],
            onTick: ({ battle: b }) => {
              if (!unit.alive || !unit.deployed) return;
              for (const e of b.enemiesInKeys(unit.rangeKeys, unit)) {
                if (slow !== 0) b.addBuff(e, { key: 'dminon:nation:slow', duration: NATION_TICK * 2, mods: { aspd: slow }, tags: ['talent'] });
                if (dot > 0) b.dealDamage({ source: unit, target: e, amount: unit.s.atk * dot, type: 'arts', tags: ['talent', 'dminon:nation'] });
              }
            },
          });
        } },
        { install(battle, unit) { // 此身为界
          const scale = num(t2.atk_scale), stun = num(t2.stun);
          if (!(scale > 0)) return;
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            const keys = [...unit.rangeKeys];
            for (const e of battle.enemiesInKeys(keys, unit)) {
              battle.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'dminon:boundary'] });
              if (stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
            }
          }, { owner: unit });
        } },
      ],
      skills: {
        [S1]: { // 停步
          kind: 'duration', duration: 20,
          mods: { aspd: num(b1.attack_speed) },
          // "每个敌人首次踏上“国度”时会停顿sluggish秒": one 停顿 per enemy per use, so this use starts with an empty set.
          onStart({ unit }) { unit.mem.dminonStopped = new Set(); },
          // Every tick: the first time an enemy's body is in the 国度 it takes the engine's 停顿 (`sluggish`). `seen` is the
          // per-use set, so the only guard is `stopFor > 0` (a record without the key does nothing).
          onTick({ battle, unit }) {
            if (!(stopFor > 0)) return;
            const seen = unit.mem.dminonStopped || (unit.mem.dminonStopped = new Set());
            for (const e of battle.enemies) {
              if (!e.alive || !e.deployed || seen.has(e.id) || !inNation(unit, e)) continue;
              seen.add(e.id);
              battle.applyStatus(e, 'sluggish', { duration: stopFor, source: unit });
            }
          },
        },
        [S2]: { // 受戮
          kind: 'duration', duration: 20,
          targeting: { rangeGrid: r2?.rangeGrid ?? null },
          mods: { atkPct: num(b2.atk), aspd: num(b2.attack_speed) },
          onStart({ battle, unit }) {
            // "第二次及以后使用时额外使攻击速度+30，且持续时间无限" — tracked per unit on the skill stack
            const seen = (unit.mem.dminonUses = (unit.mem.dminonUses || 0) + 1);
            if (seen >= 2) {
              statBuff(battle, unit, 'dminon:repeat', { aspd: num(b2.attack_speed) });
              if (unit.skill && unit.skill.duration !== undefined) {
                // [ASSUMED] the engine's timed skill duration is the data's; the "infinite" repeat is expressed as the
                // skill's own 20 s plus this persistent buff, since no data field carries an infinite duration.
              }
            }
          },
        },
        [S3]: { // 无人的国度
          kind: 'duration', duration: 36,
          targeting: { rangeGrid: r3?.rangeGrid ?? null, allInRange: true },
          mods: { atkPct: num(b3.atk), aspd: num(b3.attack_speed) },
          onStart({ battle, unit }) {
            const scale = num(b3['attack@aoe_atk_scale']);
            const cd = Math.max(0, num(b3['attack@cd'], 0.5));
            if (!(scale > 0)) return;
            let ready = 0;
            const hurt = new Set();   // allies an enemy's attack landed on (the `damaged` hook has no attacker identity)
            battle.on('damaged', (c) => {
              if (c.target && c.target.side === 'ally' && c.amount > 0) hurt.add({ u: c.target, at: battle.time });
            }, { owner: unit });
            battle.addBuff(unit, {
              key: 'dminon:nation:spread', interval: 0.1, duration: 36, tags: ['skill'],
              onTick: ({ battle: b }) => {
                if (b.time < ready || !hurt.size) return;
                for (const h of [...hurt]) {
                  if (b.time - h.at > 0.2) { hurt.delete(h); continue; }
                  const a = h.u;
                  hurt.delete(h);
                  if (!a || !a.alive || !a.deployed) continue;
                  ready = b.time + cd;
                  const r0 = Math.round(a.y), c0 = Math.round(a.x);
                  const ring = [tk(r0 - 1, c0), tk(r0 + 1, c0), tk(r0, c0 - 1), tk(r0, c0 + 1), tk(r0, c0)];
                  for (const e of b.enemiesOnTiles(ring, unit)) {
                    b.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale, type: 'phys', tags: ['skill', 'dminon:spread'] });
                  }
                  break;
                }
              },
            });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'dminon:nation:spread'); },
        },
      },
      install(battle, unit) {
        // 受戮: "使“国度”上的敌人无法闪避物理和法术攻击" — the engine's 无视闪避 channel: attack/helpers.js damageDodgeMode
        // reads `dmg.dodgeMode` after the `hit` hooks, and injuryEffects skips the roll on 'ignore', so an enemy's
        // dodgePhys / dodgeArts (a boss's `evade` buff, an aura, a status) never fires on it while the skill runs. The
        // enemy's own dodge buffs are left alone — only the roll is refused, so nothing has to be restored afterwards.
        if (picked !== S2) return;
        battle.on('hit', (ctx) => {
          const d = ctx.dmg, t = ctx.target;
          if (!d || !t || t.side !== 'enemy' || d.cancel || !(d.type === 'phys' || d.type === 'arts')) return;
          if (!up(unit) || !s2On(unit) || !inNation(unit, t)) return;
          d.dodgeMode = 'ignore';
        }, { owner: unit });
      },
    };
  },
};
