// tools/regulations-import.mjs — 把官方《卫戍协议·规程》的导出表（CSV/JSON）规范成一份可校对的数据文件。
//
// 用法：
//   node tools/regulations-import.mjs                     # 默认读 docs/reference/regulations-operators.csv 与 -bonds.csv
//   node tools/regulations-import.mjs --operators a.csv --bonds b.csv --out docs/reference/regulations.json
//   node tools/regulations-import.mjs --json export.json  # 已经是 JSON 时只做校验/规范化
//
// 它不改游戏数据，只输出规范化结果与问题清单；等数值核对后再决定怎么合并进 data/chess.json、data/bonds.json 与 config。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_DIR = path.join(ROOT, 'docs', 'reference');

const args = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** 表头别名 → 规范字段名（兼容中英文导出的列名）。 */
const OPERATOR_ALIASES = {
  name: ['name', '名称', '干员', '干员名称'],
  class: ['class', '职业', '职业分支'],
  bond: ['bond', '盟约', '盟约名', '所属盟约'],
  rarity: ['rarity', '稀有度', '星级'],
  cost: ['cost', '费用', '价格'],
  desc: ['desc', 'description', '效果', '描述', '技能', '技能效果'],
};
const BOND_ALIASES = {
  bond: ['bond', '盟约', '盟约名', '名称'],
  tier: ['tier', '人数', '层数', '档位', '人数/层数'],
  effect: ['effect', '效果', '数值', '增益'],
  desc: ['desc', 'description', '描述', '说明'],
};

/** 极简 CSV 解析（支持引号、逗号、换行、双引号转义、CRLF、BOM）。 */
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

function mapHeader(header, aliases) {
  const out = {};
  header.forEach((h, idx) => {
    const key = String(h).trim().toLowerCase();
    for (const [field, names] of Object.entries(aliases)) {
      if (names.some((n) => n.toLowerCase() === key)) { out[idx] = field; return; }
    }
  });
  return out;
}

function rowsToObjects(rows, aliases, label) {
  if (!rows.length) return [];
  const header = rows[0];
  const map = mapHeader(header, aliases);
  const missing = Object.keys(aliases).filter((f) => !Object.values(map).includes(f));
  if (missing.length) console.warn(`[${label}] 缺少列：${missing.join(', ')}（表头：${header.join(' | ')}）`);
  return rows.slice(1).map((r) => {
    const o = {};
    Object.entries(map).forEach(([idx, field]) => { o[field] = String(r[idx] ?? '').trim(); });
    return o;
  });
}

function readJson(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const operators = Array.isArray(doc) ? doc : (doc.operators || []);
  const bonds = Array.isArray(doc) ? [] : (doc.bonds || []);
  return { operators, bonds };
}

function normalizeName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function main() {
  const jsonPath = argOf('json');
  let operators = [];
  let bonds = [];

  if (jsonPath) {
    const doc = readJson(path.resolve(ROOT, jsonPath));
    operators = doc.operators;
    bonds = doc.bonds;
  } else {
    const opPath = path.resolve(ROOT, argOf('operators', path.join(DEFAULT_DIR, 'regulations-operators.csv')));
    const bondPath = path.resolve(ROOT, argOf('bonds', path.join(DEFAULT_DIR, 'regulations-bonds.csv')));
    if (fs.existsSync(opPath)) operators = rowsToObjects(parseCsv(fs.readFileSync(opPath, 'utf8')), OPERATOR_ALIASES, '干员');
    else console.warn(`未找到干员表：${opPath}`);
    if (fs.existsSync(bondPath)) bonds = rowsToObjects(parseCsv(fs.readFileSync(bondPath, 'utf8')), BOND_ALIASES, '盟约');
    else console.warn(`未找到盟约表：${bondPath}`);
  }

  const issues = [];
  const seenOp = new Set();
  const cleanOps = [];
  for (const o of operators) {
    o.name = normalizeName(o.name);
    if (!o.name) { issues.push('空名称的干员行已跳过'); continue; }
    if (seenOp.has(o.name)) issues.push(`干员重名：${o.name}`);
    seenOp.add(o.name);
    if (!o.desc) issues.push(`干员缺少效果描述：${o.name}`);
    cleanOps.push(o);
  }

  const seenBond = new Map();
  const cleanBonds = [];
  for (const b of bonds) {
    b.bond = normalizeName(b.bond);
    if (!b.bond) { issues.push('空盟约名的行已跳过'); continue; }
    if (!seenBond.has(b.bond)) seenBond.set(b.bond, new Set());
    const tiers = seenBond.get(b.bond);
    if (b.tier) {
      if (tiers.has(b.tier)) issues.push(`盟约重复档位：${b.bond} / ${b.tier}`);
      tiers.add(b.tier);
    } else issues.push(`盟约缺少人数/层数：${b.bond}`);
    cleanBonds.push(b);
  }

  const out = {
    source: jsonPath || 'csv',
    generatedAt: new Date().toISOString(),
    operators: cleanOps,
    bonds: cleanBonds,
  };
  const outPath = path.resolve(ROOT, argOf('out', path.join(DEFAULT_DIR, 'regulations.json')));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

  console.log(`干员 ${cleanOps.length} 行，盟约 ${cleanBonds.length} 行 → ${path.relative(ROOT, outPath)}`);
  console.log(`盟约 ${seenBond.size} 个；问题 ${issues.length} 条`);
  if (issues.length) {
    const reportPath = outPath.replace(/\.json$/, '-issues.txt');
    fs.writeFileSync(reportPath, `${issues.join('\n')}\n`);
    console.log(`问题清单：${path.relative(ROOT, reportPath)}`);
  }
}

main();
