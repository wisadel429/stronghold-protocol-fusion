// server/sim/content/kits/ops/op-oxi.js — 塔露拉 (char_4247_oxi) 自选 operator kit: 6★ 近卫·本源近卫 (primguard), an owned-6★
// pick of the tier-5 and tier-6 自选 slots. Every skill, both talents and the trait.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Data: character_table / skill_table of the v79 client (docs/research/26-v79-diy-operators.json — tables this
// repository's .cache snapshot predates), built into data/backups.json units.char_4247_oxi; every number is read from the
// record's blackboards at the chess's rank (normal form rank 4, elite rank 7), never from memory. v79 ships no module for
// her (`charEquip` empty), so both forms fight without one.
//
// Trait 本源近卫 "能够阻挡两个敌人，可以造成元素伤害": block 2 is the profession default; the 元素伤害 half is T1's.
// [ASSUMED] the arts conversion T1 states ("攻击造成法术伤害") is expressed as the branch's attack type: the sim has no
// "a talent rewrites the normal attack's damage type" channel, and the branch's only operator converts every attack, which
// is the same shape 本源术师 / 本源铁卫 get from their profession defaults.
//
// - T1 绝不妥协 (ep_damage_ratio, arcane_idle_delay, arcane_step_interval, arcane_step, arcane_max): every 法术伤害 she
//   deals adds `ep_damage_ratio` × the damage dealt of 灼燃损伤 ("N% 伤害的…损伤" scales off the damage, docs/SIM.md §7.4);
//   while she has not attacked for `arcane_idle_delay` s her 法术/元素 damage ramps by `arcane_step` every
//   `arcane_step_interval` s up to `arcane_max`, and one attack resets it ("每次攻击时衰减").
//   [ASSUMED] the ramp scales the damage this kit sources from her (the arts instance and the burn beside it); bond / item
//   damage of hers is not ramped.
// - T2 我即火焰 (field_duration, field_interval, field_atk_scale, max_count): a 灼燃 gauge bursting on an enemy inside her
//   attack range leaves 足迹 around it for `field_duration` s — `field_atk_scale` × ATK arts every `field_interval` s to
//   ground enemies standing on it, at most `max_count` tiles ("最多 25 格"). Uses the engine's `elementBurst` hook.
//   [ASSUMED] the official footprint is a trail; only its size and cadence are in the blackboard, so the tiles are the
//   burst target's own plus the ring around it, clipped to her attack range.
// - S1 照霎白夜 (AUTO, instant): 攻击力 `atk_scale` × ATK arts to the ground enemies on the target's tile, then 恐惧
//   `fear` s on them.
// - S2 阂断骤雪 (AUTO, 可充能 5): a 庇护 of `damage_resistance` held `shelter_hold_duration` s and decaying to 0 over
//   `skill_duration` s; an enemy hit taken while it runs is answered with `retaliate_atk_scale` × ATK arts to the enemies
//   in `ability_range_radius` around her; she heals `heal_ratio` of the damage she deals; each attack on an enemy she
//   blocks stacks ATK/DEF +`atk` / +`def` for `stack_duration` s up to `max_stack_cnt` stacks.
//   [ASSUMED] the answer is radius-based (a ranged hit carries no attacker identity here), and "受到攻击时" is the AUTO
//   trigger the record already resolves.
// - S3 日冕重烈 (MANUAL, `atk` ATK %, no normal attack): a 耀火 wave every `normal_interval` s (every `overload_interval` s
//   once 过载) travelling `wave_speed` tiles/s in the deployment direction over `normal_half_width` /
//   `overload_half_width` rows either side, `heatwave_atk_scale` × ATK arts to ground enemies it sweeps, an enemy hit
//   twice by one wave taking `same_wave_repeat_damage_scale` of it; 过载 is [ASSUMED] to start with the second wave (no
//   source names its trigger — the blackboard's two interval / width pairs are what it changes).
//
// fx kinds emitted (`battle.fx(kind, {x, y, …})`, display only — nothing in the sim reads them): 'aoe' {radius, id, skill}
// for 我即火焰's burst, 'arkOperatorFx' {nativeKey, kind: 'trail' | 'hit', wave, dir, step, half, speed, last} for S3's
// 耀火波 — the client's own `projectile_chr_oxi_s_3_heatwave` rows (render/vfx/wiring.js plays them; the sim's wave has no
// projectile entity of its own).

import { num, talentBb, skillBbOf, holdProtect, statBuff, posKey } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_oxi_1';
const S2 = 'skchr_oxi_2';
const S3 = 'skchr_oxi_3';

/** Tile key of (row, col) — the engine's PosKey. */
const tk = (r, c) => r * COLS + c;

// 日冕重烈 S3 的耀火波在官方客户端里是一条弹道 prefab（index `projectile_chr_oxi_s_3_heatwave`：`_mainEffect` =
// oxi_skill_03_trail_01，CreateEffectOnProjectile = oxi_skill_03_hit_01）。本仓库的 sim 不做弹道实体：耀火波是每 0.5 s
// 一跳的 buff tick，逐格结算（`viewProjectiles: 0`），渲染层又只从 sim 弹道起播，所以这两条 prefab 一直没进对局。
// 下面两条只在每一跳之后发 `battle.fx('arkOperatorFx', …)`：**纯表现事件，不参与结算**（不改伤害、不改时序、不掷骰），
// 由 render/vfx/wiring.js 的 `arkOperatorFx` 钩子转成局内 spawn。
const TRAIL_FX = 'oxi_skill_03_trail_01';
const HIT_FX = 'oxi_skill_03_hit_01';

/**
 * 耀火波一跳的表现事件（DESIGN §8.2 的 'fx' 元组；只读 unit 的位置/朝向与这一跳受到的敌人）。
 * `trail`：波的前端格——`front - 1 .. front` 那两行的中线，沿部署方向每一跳前进一格（`speed` = 1 格 / 0.5 s = 2 格/s，
 * 供渲染层在两次事件之间平滑推移）；`last` 是这一跳之后波离开棋盘的那一跳，渲染层据此停掉拖尾。
 * `hit`：这一跳实际打着的一个敌人一发，落点就是它的格。
 */
function waveFx(battle, unit, { wave, overload, front, half, dir, r, c, struck, last }) {
  const at = Math.max(0.5, front - 0.5);   // 两行 band 的中线
  const x = dir === 'LEFT' ? c - at : dir === 'UP' || dir === 'DOWN' ? c : c + at;
  const y = dir === 'UP' ? r - at : dir === 'DOWN' ? r + at : r;
  battle.fx('arkOperatorFx', {
    x, y, id: unit.id, unitId: unit.id, nativeKey: TRAIL_FX, kind: 'trail',
    wave, dir, step: front, half, overload: overload ? 1 : 0, speed: 2, last: last ? 1 : 0,
  });
  for (const e of struck) battle.fx('arkOperatorFx', { x: e.x, y: e.y, id: unit.id, unitId: unit.id, nativeKey: HIT_FX, kind: 'hit', wave, dir });
}

/** The artes-damage ramp of 绝不妥协, per unit (module state would leak between battles). */
const RAMPS = new WeakMap();
const rampOf = (u) => {
  let r = RAMPS.get(u);
  if (!r) { r = { mult: 0, idle: 0 }; RAMPS.set(u, r); }
  return r;
};

export default {
  char_4247_oxi: (bb, chess) => {
    const t1 = talentBb(chess, 0);
    const t2 = talentBb(chess, 1);
    const b1 = skillBbOf(chess, S1);
    const b2 = skillBbOf(chess, S2);
    const b3 = skillBbOf(chess, S3);
    const burnRatio = num(t1.ep_damage_ratio);
    return {
      trait: { dmgType: 'arts' },
      talents: [
        { install(battle, unit) { // 绝不妥协
          const step = num(t1.arcane_step);
          const cap = num(t1.arcane_max);
          const every = Math.max(0.1, num(t1.arcane_step_interval, 0.5));
          const idle = num(t1.arcane_idle_delay, 3);
          if (step > 0 && cap > 0) {
            battle.addBuff(unit, {
              key: 'oxi:arcane', interval: every, persist: true, allowDead: true,
              onTick: ({ unit: u }) => {
                const r = rampOf(u);
                r.idle += every;
                if (r.idle >= idle) r.mult = Math.min(cap, r.mult + step);
              },
            });
          }
          battle.on('damageOutput', (c) => {
            if (c.source !== unit || !unit.alive) return;
            const dmg = c.dmg;
            if (!dmg || dmg.type !== 'arts' || !(c.amount > 0)) return;
            const r = rampOf(unit);
            if (r.mult > 0) c.amount = c.amount * (1 + r.mult);
            if (burnRatio > 0 && c.target && c.target.side === 'enemy') {
              battle.dealElementDamage({ source: unit, target: c.target, amount: c.amount * burnRatio, element: 'burn', tags: ['talent', 'oxi:unbending'] });
            }
          }, { owner: unit });
          battle.on('damageCalculate', (c) => { // her own attack ends the idle run
            if (c.source !== unit || !c.dmg || !c.dmg.isAttack) return;
            const r = rampOf(unit);
            r.idle = 0;
            r.mult = 0;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 我即火焰
          const dur = num(t2.field_duration);
          const scale = num(t2.field_atk_scale);
          const interval = Math.max(0.1, num(t2.field_interval, 0.3));
          const maxTiles = Math.max(1, num(t2.max_count, 25));
          if (!(dur > 0) || !(scale > 0)) return;
          battle.on('elementBurst', (c) => {
            if (c.element !== 'burn' || !unit.alive || !unit.deployed) return;
            const t = c.target;
            if (!t || t.side !== 'enemy') return;
            if (!battle.enemiesInKeys(unit.rangeKeys, unit).includes(t)) return;
            const r0 = Math.round(t.y), c0 = Math.round(t.x);
            const keys = [];
            for (let dr = -1; dr <= 1 && keys.length < maxTiles; dr++) {
              for (let dc = -1; dc <= 1 && keys.length < maxTiles; dc++) keys.push(tk(r0 + dr, c0 + dc));
            }
            battle.addBuff(unit, {
              key: `oxi:field:${r0}:${c0}`, duration: dur, interval, tags: ['talent'],
              onTick: ({ battle: b }) => {
                for (const e of b.enemiesOnTiles(keys, unit)) {
                  b.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'oxi:flame'] });
                }
              },
            });
            battle.fx('aoe', { x: t.x, y: t.y, radius: 1, id: unit.id, skill: 'oxi:field' });
          }, { owner: unit });
        } },
      ],
      skills: {
        [S1]: { // 照霎白夜
          kind: 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 1), dmgType: 'arts', splashRadius: 0.5, groundOnly: true,
            onHit({ battle, unit, target }) {
              if (!target || target.side !== 'enemy') return;
              const fear = num(b1.fear);
              if (fear > 0) battle.applyStatus(target, 'fear', { duration: fear, source: unit });
            },
          },
        },
        [S2]: { // 阂断骤雪
          kind: 'charges',
          onStart({ battle, unit }) {
            const v = num(b2.damage_resistance);
            const hold = num(b2.shelter_hold_duration);
            const span = Math.max(hold, num(b2.skill_duration));
            if (v > 0) holdProtect(battle, unit, v, span);
            const radius = Math.max(1, num(b2.ability_range_radius));
            const retal = num(b2.retaliate_atk_scale);
            const healRatio = num(b2.heal_ratio);
            const stackAtk = num(b2.atk), stackDef = num(b2.def);
            const maxStacks = Math.max(1, num(b2.max_stack_cnt, 5));
            const stackDur = num(b2.stack_duration);
            let stacks = 0;
            let until = 0;
            battle.addBuff(unit, { key: 'oxi:snow', duration: span, tags: ['skill'] });
            if (retal > 0) battle.on('damaged', (c) => {
              if (c.target !== unit || !unit.alive || !unit.skill || unit.skill.id !== S2) return;
              if (!(c.amount > 0)) return;
              const r0 = Math.round(unit.y), c0 = Math.round(unit.x);
              for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                  for (const e of battle.enemiesOnTiles([tk(r0 + dr, c0 + dc)], unit)) {
                    battle.dealDamage({ source: unit, target: e, amount: unit.s.atk * retal, type: 'arts', tags: ['skill', 'oxi:snow'] });
                  }
                }
              }
            }, { owner: unit });
            if (healRatio > 0) battle.on('damageOutput', (c) => {
              if (c.source !== unit || !(c.amount > 0) || !unit.skill || unit.skill.id !== S2) return;
              battle.heal({ source: unit, target: unit, amount: c.amount * healRatio });
            }, { owner: unit });
            if ((stackAtk > 0 || stackDef > 0) && stackDur > 0) battle.on('damageCalculate', (c) => {
              const blocked = unit.blocking || [];
              if (c.source !== unit || !c.dmg || !c.dmg.isAttack || !c.target || !blocked.includes(c.target)) return;
              const now = battle.time;
              if (now > until) stacks = 0;          // the previous window lapsed
              stacks = Math.min(maxStacks, stacks + 1);
              until = now + stackDur;
              statBuff(battle, unit, 'oxi:snow:stack', { atkPct: stackAtk * stacks, defPct: stackDef * stacks });
            }, { owner: unit });
          },
        },
        [S3]: { // 日冕重烈
          kind: 'duration', duration: 36,
          mods: { atkPct: num(b3.atk), noAttack: true },
          onStart({ battle, unit }) {
            const scale = num(b3.heatwave_atk_scale);
            const speed = Math.max(0.5, num(b3.wave_speed, 2.3));
            const repeat = num(b3.same_wave_repeat_damage_scale, 0.15);
            const travel = 3 + Math.max(0, num(b3.wave_exit_distance, 5));   // the board is 19 × 21: enough either way
            let wave = 0;
            const stillOn = () => unit.alive && unit.skill && unit.skill.active;
            const fire = () => {
              wave++;
              const waveNo = wave;          // this wave's own number: `wave` names later waves by the time a tick runs
              const overload = wave > 1;   // [ASSUMED] 过载 = from the second wave on
              const half = Math.max(0, num(overload ? b3.overload_half_width : b3.normal_half_width, 2));
              const hit = new Set();
              let front = 1;
              battle.addBuff(unit, {
                key: `oxi:wave:${wave}`, duration: Math.max(0.6, travel / speed + 0.5), interval: 0.5, tags: ['skill'],
                onTick: ({ battle: b }) => {
                  const r0 = Math.round(unit.y), c0 = Math.round(unit.x);
                  const up = unit.dir === 'UP', down = unit.dir === 'DOWN', left = unit.dir === 'LEFT';
                  const keys = [];
                  for (let step = front - 1; step <= front; step++) {
                    for (let dr = -half; dr <= half; dr++) {
                      if (left) keys.push(tk(r0 + dr, c0 - step));
                      else if (up) keys.push(tk(r0 - step, c0 + dr));
                      else if (down) keys.push(tk(r0 + step, c0 + dr));
                      else keys.push(tk(r0 + dr, c0 + step));
                    }
                  }
                  const struck = [];
                  for (const e of b.enemiesOnTiles(keys, unit)) {
                    const mul = hit.has(e) ? repeat : 1;
                    hit.add(e);
                    b.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale * mul, type: 'arts', tags: ['skill', 'oxi:wave'] });
                    struck.push(e);
                  }
                  // 纯表现（waveFx）：这一跳的前端与刚才打着的敌人；不读不改任何结算状态
                  waveFx(b, unit, {
                    wave: waveNo, overload, front, half, r: r0, c: c0, struck,
                    dir: unit.dir === 'UP' || unit.dir === 'DOWN' || unit.dir === 'LEFT' ? unit.dir : 'RIGHT',
                    last: front + 1 > travel,
                  });
                  front++;
                  if (front > travel) b.removeBuff(unit, `oxi:wave:${wave}`);
                },
              });
              battle.addBuff(unit, {
                key: `oxi:next:${wave}`,
                duration: Math.max(0.1, num(overload ? b3.overload_interval : b3.normal_interval, 2.67)),
                tags: ['skill'], onExpire: () => { if (stillOn()) fire(); },
              });
            };
            battle.addBuff(unit, {
              key: 'oxi:next:0', duration: Math.max(0.1, num(b3.normal_interval, 2.67)),
              tags: ['skill'], onExpire: () => { if (stillOn()) fire(); },
            });
          },
        },
      },
    };
  },
};
