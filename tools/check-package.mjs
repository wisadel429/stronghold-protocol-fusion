// tools/check-package.mjs — 出包后的「纯净度自查」（业主 2026-11-15 红线）。
//
//   node tools/check-package.mjs <包.zip> [口令字符串...]
//
// 检查三件事，任何一条不过就退出码 1：
//   ① 文件名：凭据 / 运行数据 / 日志 / 交接文档 / 启动器备份 —— 一律不该出现在分发包里
//   ② 运行数据：data/ 下那几个 json 必须是**空结构**（有内容说明把别人的数据打进去了）
//   ③ 内容：把包里所有文本文件解开，搜命令行给的口令字符串（0 命中才算过）
//
// 用法示例：
//   node tools/check-package.mjs ..\Stronghold-Protocol-..._2026-11-15.zip <后台口令>
//
// 注意：口令一律用占位符，**绝不要写进任何会被分发的文件**（本文件就在热更包里）。

import fs from 'node:fs';
import zlib from 'node:zlib';

const zip = process.argv[2];
const secrets = process.argv.slice(3).filter(Boolean);
if (!zip) {
  console.error('用法: node tools/check-package.mjs <包.zip> [口令字符串...]');
  process.exit(2);
}

/** 必须在包里 **不存在** 的文件名规则 */
// [正则, 说明, 级别]  error = 可能泄露个人信息（阻断）  warn = 只是不干净（提示）
const FORBIDDEN = [
  [/^admin-password\.json$/i, '后台口令（scrypt 哈希）', 'error'],
  // 热更锁（业主 2026-11-15）：独立密钥的 scrypt 密文，和后台口令同级，绝不能进包
  [/^admin-update-key\.json$/i, '热更锁（scrypt 哈希）', 'error'],
  [/(^|\/)\.env/i, '环境变量文件', 'error'],
  // 只查「根目录的 json」——server/accounts/passwords.js 这种源码文件是正常的
  [/^[^/]*(password|secret|credential)[^/]*\.json$/i, '根目录凭据文件', 'error'],
  [/^HANDOFF.*\.md$/i, '交接文档（可能含口令；需人工确认）', 'warn'],
  [/\.log$/i, '日志', 'warn'],
  [/\.bak/i, '备份文件', 'warn'],
  // 主程序 Stronghold.exe 在整包里是**必须**的；只禁它的备份副本
  [/^Stronghold\.exe\./i, '启动器备份', 'warn'],
];
/** 命中这些前缀的条目跳过文件名检查（素材名里的 token / secret 是正常词） */
const ASSET_PREFIX = /^(public\/assets|public\/ui-art|public\/fonts)\//i;
/** 默认后台口令：写在源码里是设计如此，不算泄露，但要单独提醒「部署时必须改掉」 */
const DEFAULT_PW = '88888888';
/** data/ 下必须是空结构的运行数据 */
const EMPTY_OK = new Map([
  ['data/account-sessions.json', (o) => !o.sessions || Object.keys(o.sessions).length === 0],
  ['data/saves.json', (o) => !o.saves || Object.keys(o.saves).length === 0],
  ['data/social.json', (o) => !o.friends || Object.keys(o.friends).length === 0],
  ['data/feedback.json', (o) => !o.items || o.items.length === 0],
]);
const TEXT = /\.(json|js|mjs|md|txt|ps1|bat|cmd|html|css|config|yml|yaml|ini)$/i;

const fd = fs.openSync(zip, 'r');
const size = fs.fstatSync(fd).size;
const tail = Buffer.alloc(Math.min(size, 262144));
fs.readSync(fd, tail, 0, tail.length, size - tail.length);
let eocd = -1;
for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
if (eocd < 0) { console.error('不是有效的 zip'); process.exit(2); }
// Zip64（条目 > 65535 或总长 > 4 GB）走 locator；普通 zip 直接读 EOCD 的 32 位字段。
// （以前这里无条件读 locator，普通 zip 会读到垃圾偏移然后崩 —— 业主 2026-11-15 小补丁包踩到。）
let loc = -1;
for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
let cdSize;
let cdOff;
if (loc >= 0) {
  const off = Number(tail.readBigUInt64LE(loc + 8));
  const h = Buffer.alloc(56);
  fs.readSync(fd, h, 0, 56, off);
  cdSize = Number(h.readBigUInt64LE(40));
  cdOff = Number(h.readBigUInt64LE(48));
} else {
  cdSize = tail.readUInt32LE(eocd + 12);
  cdOff = tail.readUInt32LE(eocd + 16);
}
const cd = Buffer.alloc(cdSize);
fs.readSync(fd, cd, 0, cdSize, cdOff);

const dec = new TextDecoder('gbk', { fatal: false });
const entries = [];
let p = 0;
while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
  const flags = cd.readUInt16LE(p + 8);
  const method = cd.readUInt16LE(p + 10);
  const csize = cd.readUInt32LE(p + 20);
  const usize = cd.readUInt32LE(p + 24);
  const nlen = cd.readUInt16LE(p + 28), elen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
  const loff = cd.readUInt32LE(p + 42);
  const raw = cd.subarray(p + 46, p + 46 + nlen);
  // 名字统一成正斜杠：PowerShell 的 CreateFromDirectory 在 Windows 上写的是反斜杠，
  // 不归一化的话下面所有路径匹配（含顶层目录剥离）全部失效。
  const nm = ((flags & 0x800) ? raw.toString('utf8') : dec.decode(raw)).replace(/\\/g, '/');
  entries.push({ name: nm, method, csize, usize, loff });
  p += 46 + nlen + elen + clen;
}

/** 读一个条目的原始内容（解压）。 */
function readEntry(e) {
  const lh = Buffer.alloc(30);
  fs.readSync(fd, lh, 0, 30, e.loff);
  const dataOff = e.loff + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const comp = Buffer.alloc(e.csize);
  fs.readSync(fd, comp, 0, e.csize, dataOff);
  return e.method === 0 ? comp : zlib.inflateRawSync(comp);
}

// 去掉整包自带的顶层文件夹前缀
const tops = new Set(entries.map((e) => e.name.split('/')[0]));
const pre = tops.size === 1 && [...tops][0].includes('Stronghold') ? [...tops][0] + '/' : '';
const rel = (n) => (pre && n.startsWith(pre) ? n.slice(pre.length) : n);

const problems = [];
const warnings = [];

// ① 文件名
for (const e of entries) {
  const r = rel(e.name);
  if (!r || r.endsWith('/')) continue;
  if (ASSET_PREFIX.test(r)) continue;
  for (const [re, why, level] of FORBIDDEN) {
    if (!re.test(r)) continue;
    const line = `${r}  —— ${why}`;
    if (level === 'error') problems.push('[文件名] ' + line);
    else warnings.push('[文件名] ' + line);
  }
}

// ②' 资源密钥：**服务器包可以有，玩家包不该有** —— 有就提醒「别把这个包发给玩家」
for (const e of entries) {
  const r = rel(e.name);
  if (r !== 'data/art-key.json') continue;
  try {
    const j = JSON.parse(readEntry(e).toString('utf8').replace(/^\uFEFF/, ''));
    const len = Buffer.from(String(j.key || ''), 'base64').length;
    if (len === 32) {
      warnings.push(`data/art-key.json —— 这个包含**资源密钥**（服务器版），不要发给玩家`);
    }
  } catch { /* 读不动就不管 */ }
}

// ② 运行数据必须是空的
for (const e of entries) {
  const r = rel(e.name);
  const check = EMPTY_OK.get(r);
  if (!check) continue;
  let obj;
  try { obj = JSON.parse(readEntry(e).toString('utf8').replace(/^\uFEFF/, '')); } catch { problems.push(`[运行数据] ${r} —— 不是合法 JSON`); continue; }
  if (!check(obj)) problems.push(`[运行数据] ${r} —— 含实际数据（${e.usize} 字节），发布前必须清空`);
}

// ③ 内容扫描
let scanned = 0, bytes = 0; const defaultHits = [];
for (const e of entries) {
  const r = rel(e.name);
  if (!TEXT.test(r) || e.usize > 3 * 1024 * 1024) continue;
  let buf;
  try { buf = readEntry(e); } catch { continue; }
  scanned++; bytes += buf.length;
  for (const s of secrets) {
    if (!buf.includes(Buffer.from(s, 'utf8'))) continue;
    if (s === DEFAULT_PW) { defaultHits.push(r); continue; }
    problems.push(`[口令] ${r} 里出现了「${s}」`);
  }
}
fs.closeSync(fd);

console.log(`检查：${zip}`);
console.log(`  条目 ${entries.length} 个；文本扫描 ${scanned} 个（${(bytes / 1024 / 1024).toFixed(1)} MB）`);
if (secrets.length) console.log(`  口令检查：${secrets.map((s) => s.slice(0, 3) + '***').join(', ')}`);
if (defaultHits.length) {
  console.log(`\n提示：默认口令「${DEFAULT_PW}」出现在 ${defaultHits.length} 个文件里（源码常量 / 文档约定，不算泄露）；`);
  console.log('     但**部署时务必用 ADMIN_PASSWORD 环境变量或后台改掉它**。');
}
if (warnings.length) {
  console.log(`\n警告（不干净但不泄露个人信息）：${warnings.length} 处`);
  for (const x of warnings.slice(0, 20)) console.log('  ⚠ ' + x);
  if (warnings.length > 20) console.log(`  … 其余 ${warnings.length - 20} 处`);
  console.log('  建议：下次用 tar 重打时加 --exclude=\'*.bak*\' --exclude=\'Stronghold.exe.old\' --exclude=\'HANDOFF-*.md\'');
}
if (problems.length === 0) {
  console.log('\nRESULT 通过 —— 没有发现凭据 / 个人数据');
  process.exit(0);
}
console.log(`\nRESULT 不通过，${problems.length} 处必须处理：`);
for (const x of problems.slice(0, 40)) console.log('  ✗ ' + x);
if (problems.length > 40) console.log(`  … 其余 ${problems.length - 40} 处`);
process.exit(1);
