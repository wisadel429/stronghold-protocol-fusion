// server/sim/content/bonds/addon/zjbonds.js — 炸惊模拟新增的盟约：岁 / 企鹅物流 / 医师 / S.E.E.S。
//
// 原版数据里这三个是 bondType=NORMAL 的空壳（bb={}、buffs=[]），成员只记在 chess 记录的 bonds 里，战斗里没有
// 任何效果。它们的数值与文案全部写在 data/bonds.json 的 `zj` 块里、只在炸惊模拟下合并进来（shared/zjBonds.js），
// 所以这里也只在炸惊下生效 —— 判据是黑板上有没有 `zj_` 前缀的键：其它难度拿到的 bb 里没有这些键，num() 全是 0，
// 整个 install 直接空转（连钩子都不注册）。
//
//   岁 suiShip            2 名：成员攻击力、防御力各 +zj_atk_def_pct（直接乘算）
//                        3 名：成员的攻击额外造成该次伤害 zj_burn_ratio 的灼燃损伤（element：burn）
//                        4 名（天有四时）：成员攻击力额外 +zj_sui_atk_pct；
//                              场上所有干员生命 +zj_all_hp_pct、攻击速度 +zj_aspd、技力恢复 +zj_sp_regen/秒
//   企鹅物流 penguinShip  2 名：场上所有干员再部署时间 ×(1 + zj_redeploy_2)
//                        3 名：再部署时间 ×(1 + zj_redeploy_3)，且部署费用为 0（zj_free_deploy）
//   医师 physicianShip     1 名：成员攻击力 ×(1 + zj_atk_pct)
//   S.E.E.S seesShip      成员攻击力 +（base_atk + atk_per_stack×层数），攻击速度 +（base_attack_speed +
//                         attack_speed_per_stack×层数）。★ 它的数值写在**基础记录**的 bb 上（这条没有 `zj` 覆盖块），
//                         所以门不是「黑板有没有 `zj_` 键」而是「这场战斗有没有炸惊视图」（`battle.zj`，只在 modeId
//                         含 zhajing 时非 null —— Battle.js zjViewFor）；它的成员全是 chess_zj_*，其它难度凑不齐人。
//                         层数会变（由加莉 / 等阶进制的「已激活盟约 +N」），所以这一条走 layerGain 重算。
//                         另两条（2026-11-01 补齐，文案原文见 data/bonds.json 的 seesShip.zj.descRaw）：
//                         <每叠加100层>【S.E.E.S】成员技力需求-1（`spCostFlat`；召唤器 ×2；至少留 1 点）、
//                         <每叠加200层>【S.E.E.S】成员持续类技能的持续时间-1s（最多减到1s）（`skillStart` 里改
//                         `SkillRuntime.duration` / `.timeLeft`，见 SEES_DUR_* 的注释）。
//                         未实现（引擎没有承载点）：<在场5名不同成员>的「结城理」天赋「S.E.E.S队长」伤害
//                         （kit 侧已按层数算，chess_zj_60_5-makoto.js；盟约侧没有「按盟约改天赋伤害」的通路）。
//
// 岁 / 企鹅物流 / 医师 在炸惊下都没有随层数变化的数值，所以只需要装一次；只有 S.E.E.S 随层数重算。
// 装配顺序：content/bonds.js 的 PARTS 是 core → addon → mujicaBond；本文件由 addon.js 的 install 在
// addon/battle.js 之后调用（与参考包 addon.js 的 installBattle → installZjBonds 同序），所以它先于 mujicaBond 的
// 战斗侧钩子。颂乐人偶（mujicaShip，也是 zjOnly 盟约）在 mujicaBond.js / mujica.js（engine-cards）/ 本仓的
// support 里实现，不在本文件。
//
// 0.3.3 API 适配：伤害走 `battle.dealElementDamage({ source, target, amount, element })`（参考包用的是旧的位置参数
// `battle.dealDamage(u, tgt, { type:'element' })`，0.3.3 的 attack.js 明确拒绝用 dealDamage 打元素条）。

import {
  num, bondRecord, buffParams, bondTier, bondLayers, isMember, playerOps, passiveBuff, fxOn, directMods, battleStore,
} from '../../support/index.js';

const ID = Object.freeze({
  sui: 'suiShip', penguin: 'penguinShip', physician: 'physicianShip', sees: 'seesShip',
});
const KEY = Object.freeze({
  suiAtkDef: 'bond:suiShip:atkdef',
  suiTianAtk: 'bond:suiShip:tian:atk',
  suiTianAll: 'bond:suiShip:tian:all',
  penguin: 'bond:penguinShip:redeploy',
  physician: 'bond:physicianShip',
  sees: 'bond:seesShip',
});
/**
 * <每叠加200层>【S.E.E.S】成员持续类技能的持续时间-1s（最多减到1s）。
 *
 * 文案原文（`data/bonds.json` → `seesShip.zj.descRaw` 第 4 行，官方 `effectDescRaw` 同句）：
 *   「<每叠加<@ba.vup>200</>层>【S.E.E.S】成员<@ba.vup>持续类技能</>的持续时间<@ba.vup>-1s</><@autochess.gray>（最多减到1s）</>」
 *
 * 这三个数字（200 / 1s / 下限 1s）**只**写在文案里：官方黑板 `seesShip.bb` 没有这一条的任何键 —— 它只有
 * base_atk / atk_per_stack / base_attack_speed / attack_speed_per_stack / base_sees_talent /
 * sees_talent_per_stack / **sees_milestone / sees_milestone_per**，而后两个是「<每叠加100层>技力需求-1
 * （已触发 {3:0} 次）」那条的**触发计数**（`effectDescParams` 的 `{3}`：base=sees_milestone(0)、
 * perStack=sees_milestone_per(1)、divisor=100 ⇒ (0 + 1×L)/100 = 这条 SP 效果已触发几次），与持续时间无关
 * （见 test/content/zj-sees-bond.test.js 的「sees_milestone 语义」一例）。所以这里**不往 data 里塞伪造的黑板键**，
 * 常量写在代码里，并断言它们与数据文案逐字相符（同一测试文件从 `data/bonds.json` 现读 200 / 1 / 1 比对）。
 * （弹窗里「已触发 {3:0} 次」由 `public/js/ui/richText.js` 的 formatBondEffect 现算：它读这个 `divisor`，印
 *  `floor((base + perStack×L) / divisor)`，与服务端上面这个 `Math.floor(L / 100)` 同一口径 —— 2026-11-01 修好前
 *  它只算 `base + perStack×L`，200 层会印成「已触发 200 次」。）
 */
const SEES_DUR_LAYER = 200;   // 「每叠加200层」
const SEES_DUR_SEC = 1;       // 「持续时间-1s」
const SEES_DUR_FLOOR = 1;     // 「最多减到1s」
/** 每名干员的 `SkillRuntime` → 它**没被这条盟约改过**的时长（见 install 里 skillStart 钩子的注释）。 */
const SEES_SKILL_BASE = new WeakMap();
/**
 * 随层数变化的被动（S.E.E.S）：core.js 的同名设施是私有的，这里只留最小的一份 —— 按 (pid, bondId) 登记一个重算函数，
 * 层数变化后的下一拍重读（`Battle.addLayers` 先发事件、后落数，所以延一拍）。
 */
const REFRESH = 'zj:fresh';
function refreshOnLayers(battle, pid, bondId, fn) {
  const st = battleStore(battle, REFRESH, () => ({ fns: new Map(), pending: new Set(), hooked: false }));
  const k = `${pid}|${bondId}`;
  if (!st.fns.has(k)) st.fns.set(k, []);
  st.fns.get(k).push(fn);
  if (st.hooked) return;
  st.hooked = true;
  battle.on('layerGain', (c) => {
    const key = `${c.playerId}|${c.bondId}`;
    const list = st.fns.get(key);
    if (!list || st.pending.has(key)) return;
    st.pending.add(key);
    battle.after(0, () => { st.pending.delete(key); for (const f of list) f(); });
  }, { priority: -100 });
}

/** 岁 3 名档的灼燃损伤标记：它自己是元素条伤害，钩子里据此不再二次触发。 */
const BURN_TAG = 'bond:suiShip:burn';
/** 企鹅物流 3 名档暂存的原部署费用（`unit.base.cost`）。 */
const PENGUIN_COST = 'zj:penguin:cost';

/** 每个盟约的「炸惊标记键」：黑板上没有它 = 不是炸惊，这个盟约整个不装（连钩子都不注册）。 */
const MARK = Object.freeze({
  suiShip: 'zj_atk_def_pct',
  penguinShip: 'zj_redeploy_2',
  physicianShip: 'zj_atk_pct',
});

/**
 * 盟约的数值袋：顶层 `bb` 合并 `env_gbuff_new` 黑板。这三个盟约原版 `buffs` 是空的（没有 `env_gbuff_new` 条目），
 * 炸惊的数值只落在合并后的顶层 `bb` 上，所以两边都要读 —— 与 core.js / addon/battle.js 只读黑板不同。
 * @param {string} bondId
 */
const bbOf = (bondId) => {
  const rec = bondRecord(bondId);
  return { ...((rec && rec.bb) || {}), ...(buffParams(rec, 'env_gbuff_new') ?? {}) };
};

/**
 * 是否戴着某件道具（`unit.items` 是道具 **id 字符串** 的数组；宽松地也认 `{ id }`）。前缀匹配，
 * 因为同一件道具的普通 / 精锐形态是 `_a` / `_b` 两个 id。
 * @param {any} u @param {string} prefix 例如 'chess_item_sees_evoker'
 */
function wearsItem(u, prefix) {
  if (!u || !Array.isArray(u.items)) return false;
  return u.items.some((it) => String(it && typeof it === 'object' ? it.id : it).startsWith(prefix));
}

/**
 * 把一批干员的部署费用改成 0（deploy.js / tiles.js 都读 `unit.base.cost`），不在名单里的还原。盟约掉档或干员
 * 离场时费用要还回去，所以记一份原值。
 */
function applyFreeCost(battle, ops) {
  const saved = battleStore(battle, PENGUIN_COST, () => new Map());
  const want = new Set(ops);
  for (const [u, cost] of [...saved]) if (!want.has(u)) { u.base.cost = cost; saved.delete(u); }
  for (const u of want) if (!saved.has(u)) { saved.set(u, u.base.cost); u.base.cost = 0; }
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players) || !battle.players.length) return;
  // S.E.E.S 的数值写在基础记录的 bb 上（没有 `zj` 覆盖块），所以它的门是「这场战斗有没有炸惊视图」而不是黑板键。
  const zj = !!battle.zj;
  const states = [];
  for (const p of battle.players) {
    const st = { pid: p.playerId, ops: playerOps(battle, p.playerId), tiers: {}, bb: {}, members: {} };
    for (const id of Object.values(ID)) {
      const t = bondTier(battle, st.pid, id);
      if (t <= 0) continue;
      const bb = bbOf(id);
      if (id === ID.sees) {
        // 非炸惊 ⇒ 整个盟约不装（它的成员全是 chess_zj_*，其它难度也凑不齐人）
        if (!zj) continue;
      } else if (!Object.hasOwn(bb, MARK[id])) {
        // 非炸惊（普通难度拿不到 `zj` 覆盖块）→ 整个盟约不装，其它模式完全不受影响
        continue;
      }
      st.tiers[id] = t;
      st.bb[id] = bb;
      st.members[id] = new Set(st.ops.filter((u) => isMember(battle, u, id)));
    }
    if (Object.keys(st.tiers).length) states.push(st);
  }
  if (!states.length) return;
  const byPid = Object.create(null);
  for (const st of states) { byPid[st.pid] = st; applyPassives(battle, st); }
  const has = (id, tier = 1) => states.some((st) => (st.tiers[id] ?? 0) >= tier);

  // 岁 3 名档：成员造成的伤害附带 zj_burn_ratio（20%）的灼燃损伤。元素条伤害自己不再触发。
  if (has(ID.sui, 2)) {
    battle.on('damaged', (c) => {
      const u = c.source;
      if (!u || !c.dmg || c.type === 'element' || !(c.amount > 0)) return;
      const st = byPid[u.ownerId];
      if (!st || (st.tiers[ID.sui] ?? 0) < 2 || !st.members[ID.sui].has(u)) return;
      const tgt = c.target;
      if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
      const ratio = num(st.bb[ID.sui].zj_burn_ratio);
      if (!(ratio > 0)) return;
      battle.dealElementDamage({ source: u, target: tgt, amount: c.amount * ratio, element: 'burn', tags: [BURN_TAG] });
    });
  }

  // 天有四时：成员落地时给一次提示（纯表现）
  if (has(ID.sui, 3)) {
    battle.on('deploy', (c) => {
      const u = c.unit;
      const st = u && byPid[u.ownerId];
      if (!st || (st.tiers[ID.sui] ?? 0) < 3 || !st.members[ID.sui].has(u) || u.mem.zjSuiTian) return;
      u.mem.zjSuiTian = true;
      fxOn(battle, 'bondMilestone', u, ID.sui, 'tian');
    });
  }

  // S.E.E.S「<每叠加200层>【S.E.E.S】成员持续类技能的持续时间-1s（最多减到1s）」。
  //
  // 承载点：引擎里一条技能的时长就是 `SkillRuntime.duration`（skills.js 的构造函数从 spec/def 算出），开技时
  // `timeLeft = max(0.01, duration)` 开始倒计时、`timeLeft <= 0` 结束（skills.js activate / tick）—— 没有任何
  // mod 键能改它（buffs.js 的 ADD_KEYS / MUL_KEYS 里没有时长键，`spCostFlat` 那类只对技力需求有效）。内容侧改这个
  // 窗口是**引擎明文支持**的：docs/SIM.md §hooks 的 `skillStart` 一行写着「mutate `skill.ammoLeft` /
  // `skill.timeLeft` in skillStart」。所以这里就在 skillStart 里按层数缩短本拍的窗口，`duration` 一起改 ——
  // 技力条（snapshot：`sp = duration × timeLeft/duration`）与 AUTO_STOP 的「半程」判定才跟得上真实的 19 s。
  //
  // 只动 `kind === 'duration'`（有限时长）：弹药类（kind 'ammo'，`duration` 是「最多持续」的上限，不是持续时间）
  // 与无限时长的（toggle / timeLeft 为 Infinity）都不改。[ASSUMED 「持续类技能」= 有限时长的 duration 技能；文案没
  // 点名弹药类与无限时长技能。] 层数在开技那一拍取一次（技能时长中途不重算）——「持续时间」是开技时定下的事实。
  if (has(ID.sees)) {
    battle.on('skillStart', (c) => {
      const unit = c && c.unit;
      const skill = c && c.skill;
      const st = unit && byPid[unit.ownerId];
      if (!st || (st.tiers[ID.sees] ?? 0) < 1 || !st.members[ID.sees].has(unit) || !skill) return;
      if (skill.kind !== 'duration' || !Number.isFinite(skill.timeLeft) || !(skill.duration > 0)) return;
      // 基线只能用**第一次改动之前**的时长：`SkillRuntime` 是每名干员一个、跨多次开技复用，直接读 `skill.duration`
      // 会在第二次开技时把上一次已经减过的 19 再减成 18。所以第一次遇到这条技能时把原时长存进 WeakMap，之后都从它算。
      const base = SEES_SKILL_BASE.has(skill) ? SEES_SKILL_BASE.get(skill) : skill.duration;
      if (!SEES_SKILL_BASE.has(skill)) SEES_SKILL_BASE.set(skill, base);
      const m = wearsItem(unit, 'chess_item_sees_evoker') ? 2 : 1;   // 召唤器：「使装备者获得的【S.E.E.S】盟约效果翻倍」
      const cut = Math.floor(bondLayers(battle, st.pid, ID.sees) / SEES_DUR_LAYER) * SEES_DUR_SEC * m;
      const dur = cut > 0 ? Math.max(SEES_DUR_FLOOR, base - cut) : base;
      if (dur === skill.duration) return;   // 这一拍不用改（含「层数没到阈值」与「和上一拍一样长」）
      // 开技那一刻 `timeLeft` 刚被 activation 填成 `duration`；kit 在 onStart 里改过就只往下夹，不覆盖它的延长。
      const full = Math.abs(skill.timeLeft - skill.duration) < 1e-9;
      skill.duration = dur;
      skill.timeLeft = full ? dur : Math.min(skill.timeLeft, dur);
    }, { priority: -10 });   // 排在 kits 自己的 skillStart 改动之后（它们默认 0），改的是最终窗口
  }
}

function applyPassives(battle, st) {
  const t = st.tiers;

  // 岁：2 名 攻防 +30%
  if (t[ID.sui]) {
    const bb = st.bb[ID.sui];
    const ad = num(bb.zj_atk_def_pct);
    if (ad > 0) {
      const mods = directMods({ atk: ad, def: ad });
      for (const u of st.members[ID.sui]) passiveBuff(battle, u, KEY.suiAtkDef, mods);
    }
    // 天有四时（4 名）：岁干员攻击力额外 +zj_sui_atk_pct；场上所有干员 生命 / 攻速 / 技力恢复
    if (t[ID.sui] >= 3) {
      const atk = num(bb.zj_sui_atk_pct);
      if (atk > 0) {
        const mods = directMods({ atk });
        for (const u of st.members[ID.sui]) passiveBuff(battle, u, KEY.suiTianAtk, mods);
      }
      const hp = num(bb.zj_all_hp_pct), aspd = num(bb.zj_aspd), sp = num(bb.zj_sp_regen);
      if (hp > 0 || aspd > 0 || sp > 0) {
        const mods = directMods({ hp });
        if (aspd > 0) mods.aspd = aspd;
        if (sp > 0) mods.spRecoveryFlat = sp;
        for (const u of st.ops) passiveBuff(battle, u, KEY.suiTianAll, mods);
      }
    }
  }

  // 企鹅物流：再部署时间 -50% / -75%，3 名档部署费用为 0
  if (t[ID.penguin]) {
    const bb = st.bb[ID.penguin];
    const high = t[ID.penguin] >= 2;
    const m = high ? num(bb.zj_redeploy_3, -0.75) : num(bb.zj_redeploy_2, -0.5);
    const mods = { redeployMul: Math.max(0, 1 + m) };
    for (const u of st.ops) passiveBuff(battle, u, KEY.penguin, mods);
    applyFreeCost(battle, high && num(bb.zj_free_deploy) > 0 ? st.ops : []);
  }

  // 医师：成员攻击力 +60%
  if (t[ID.physician]) {
    const pct = num(st.bb[ID.physician].zj_atk_pct);
    if (pct > 0) {
      const mods = directMods({ atk: pct });
      for (const u of st.members[ID.physician]) passiveBuff(battle, u, KEY.physician, mods);
    }
  }

  // S.E.E.S：成员攻击力 +（base_atk + atk_per_stack×层数），攻击速度 +（base_attack_speed + attack_speed_per_stack×层数）。
  // 数值全部来自 data/bonds.json 的 bb（spec: 攻击力 = (10 + 0.25x)/100 ⇒ 0.10 + 0.0025x；攻速 = 10 + 0.2x）。
  if (t[ID.sees]) {
    const bb = st.bb[ID.sees];
    const apply = () => {
      const L = bondLayers(battle, st.pid, ID.sees);
      const atk = num(bb.base_atk) + num(bb.atk_per_stack) * L;
      const aspd = num(bb.base_attack_speed) + num(bb.attack_speed_per_stack) * L;
      for (const u of st.members[ID.sees]) {
        // 「人格面具召唤器」(`chess_item_sees_evoker`，data/items.json: 「使装备者获得的【S.E.E.S】盟约效果翻倍」)：
        // 同一份盟约数值对它的装备者整体 ×2（原包 addon/battle.js 的 `m = wearsEvoker ? 2 : 1`）。
        // 袖章 `chess_item_sees_armband` 的成员身份不需要在这里补：它的 `giveBondId` 让 `isMember` 已经算上了。
        const m = wearsItem(u, 'chess_item_sees_evoker') ? 2 : 1;
        const mods = directMods({ atk: atk * m });
        if (aspd) mods.aspd = aspd * m;
        // 「<每叠加100层>【S.E.E.S】成员技力需求-1」：`spCostFlat` 是加算键（skills.js 的
        // `floor(baseSpCost × spCostMul + spCostFlat)`），给负数就是「需求 -n」；封顶到 base-1 至少留 1 点，
        // 否则技力条整条消失（原包 2026-10-18 的同一条修正）。
        const times = Math.floor(L / 100) * m;
        if (times > 0) {
          const base = num(u.skill && u.skill.baseSpCost, 0);
          mods.spCostFlat = -(base > 0 ? Math.min(times, Math.max(0, Math.floor(base) - 1)) : times);
        }
        passiveBuff(battle, u, KEY.sees, mods);
      }
    };
    apply();
    refreshOnLayers(battle, st.pid, ID.sees, apply);
  }
}
