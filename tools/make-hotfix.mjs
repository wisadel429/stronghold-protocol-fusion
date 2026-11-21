// tools/make-hotfix.mjs — 以「已发出去的整包 zip」为基线，生成热更包。
//
//   node tools/make-hotfix.mjs --base ..\Stronghold-Protocol-v0.3.3-Fusion_2026-11-14.zip
//   node tools/make-hotfix.mjs --base <zip> --out ..\hotfix.zip --since "2026-11-14 21:30"
//
// 产物是一个**纯文件覆盖包**：条目路径相对安装根目录（没有顶层文件夹），直接覆盖解压即可。
// 判定「变了」的三种情况：基线里没有这个文件 / 大小不同 / 修改时间晚于基线时间点。
// 这样不用把 3.8 GB 全哈希一遍，几秒出包；候选文件会打印出来，便于人工确认。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.cache', '.git', 'merge-shots', 'logs', 'node_modules/.cache']);
// 打包**红线**（业主 2026-11-15）：导出物必须是纯净的，任何可能泄露个人信息的文件一律不进包。
const SKIP_FILES = new Set([
  'admin-password.json',        // 后台口令（scrypt 哈希）
  'admin-update-key.json',      // 热更锁（独立密钥的 scrypt 哈希，业主 2026-11-15）
  'data/saves.json',            // 玩家存档 / 战绩
  'data/account-sessions.json', // 登录会话 token
  'data/social.json',           // 好友关系
  'data/feedback.json',         // 玩家反馈（含 IP）
  // 业主 2026-11-15：账号库与资源密钥同样**绝不进包**（此前只写在交接文档里、代码没排，
  // 结果 2026-11-15 的热更包把 data/accounts.json 和 data/art-key.json 都打了进去）。
  'data/accounts.json',         // 账号库：QQ 号 / 密码哈希 / 昵称 / 头像
  'data/art-key.json',          // 美术资源密钥（换掉会让已加密资源永久解不开）
  'launcher-config.json',       // 本机启动器配置（服务器地址），不是服务器代码
]);
const isSkipped = (rel) => SKIP_FILES.has(rel)
  || /\.log$/i.test(rel)
  || /\.tmp$/i.test(rel)
  // 凭据 / 本地配置：.env、密钥、任何 *password* / *secret* / *token*.json
  || /(^|\/)\.env/i.test(rel)
  || /(^|\/)[^/]*(password|secret|credential)[^/]*\.json$/i.test(rel)
  || /^HANDOFF.*\.md$/i.test(rel)   // 交接文档可能含口令，不进分发包
  || /^tools\//i.test(rel)          // 维护工具（出包/自查/加解密）只留在本机，不发给玩家
  // 启动器二进制与替换脚本不进热更：运行中的 exe 在 Windows 上无法覆盖，必须关掉启动器手工替换；
  // 顺带避开中文文件名（远程用 tar 解析 zip 列表时会按 GBK 解释，导致整包被判成坏包）。
  || /^Stronghold\.exe/i.test(rel)
  || /\.cmd$/i.test(rel)
  || /\.bak/i.test(rel);

/** 没有 UTF-8 标志时按 GBK（本机代码页）解文件名；解不了再退回 UTF-8。 */
function decodeCodePage(buf) {
  try { return new TextDecoder('gbk', { fatal: false }).decode(buf); } catch { return buf.toString('utf8'); }
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

/**
 * 直接解析 zip 的中央目录（含 Zip64），拿到「路径 → 解压后大小」。
 * 比 `tar -t -v` 快几个数量级：只读目录区（几 MB），不碰 2.5 GB 数据。
 */
function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 256 * 1024);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);

    // 找 EOCD（0x06054b50），从尾部往前扫
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）');

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);

    // Zip64：条目数 > 65535 或偏移被写成 0xFFFFFFFF
    if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
      if (loc >= 0) {
        const z64Off = Number(tail.readBigUInt64LE(loc + 8));
        const hdr = Buffer.alloc(56);
        fs.readSync(fd, hdr, 0, 56, z64Off);
        if (hdr.readUInt32LE(0) === 0x06064b50) {
          count = Number(hdr.readBigUInt64LE(32));
          cdSize = Number(hdr.readBigUInt64LE(40));
          cdOff = Number(hdr.readBigUInt64LE(48));
        }
      }
    }

    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const map = new Map();
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(p + 8);
      let usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28);
      const elen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      const nameBuf = cd.subarray(p + 46, p + 46 + nlen);
      // 文件名编码：置了 UTF-8 标志（0x800）就是 UTF-8；否则很可能是本机代码页（中文 Windows = GBK）。
      // 不这么处理，中文名的 BGM 会被当成「新增」重复打进热更包。
      const name = (flags & 0x800) ? nameBuf.toString('utf8') : decodeCodePage(nameBuf);
      // 名称里不含数据；目录条目以 / 结尾，跳过
      if (!name.endsWith('/')) {
        // Zip64 extra：usize 为 0xFFFFFFFF 时真实值在扩展字段里
        if (usize === 0xffffffff && elen > 0) {
          const extra = cd.subarray(p + 46 + nlen, p + 46 + nlen + elen);
          let q = 0;
          while (q + 4 <= extra.length) {
            const id = extra.readUInt16LE(q);
            const len = extra.readUInt16LE(q + 2);
            if (id === 0x0001 && len >= 8) { usize = Number(extra.readBigUInt64LE(q + 4)); break; }
            q += 4 + len;
          }
        }
        map.set(name, usize);
      }
      p += 46 + nlen + elen + clen;
    }
    return map;
  } finally {
    fs.closeSync(fd);
  }
}

function walk(dir, rel, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(childRel)) continue;
      walk(path.join(dir, e.name), childRel, out);
    } else if (e.isFile()) {
      out.push(childRel);
    }
  }
}

function main() {
  const baseFile = path.resolve(arg('base', ''));
  if (!baseFile || !fs.existsSync(baseFile)) {
    console.error('用法: node tools/make-hotfix.mjs --base <你发出去的整包.zip> [--out <输出.zip>] [--since "YYYY-MM-DD HH:mm"]');
    process.exit(2);
  }
  const sinceArg = arg('since', null);
  const zipTime = fs.statSync(baseFile).mtime;
  const since = sinceArg ? new Date(sinceArg) : new Date(zipTime.getTime() - 10 * 60 * 1000); // 留 10 分钟余量
  console.log(`基线：${baseFile}`);
  console.log(`基线时间：${zipTime.toLocaleString()}，判定阈值：${since.toLocaleString()}`);

  const raw = zipEntries(baseFile);
  // 整包 zip 通常多包一层顶层文件夹（Stronghold-Protocol-.../），比对本机目录时要剥掉
  const tops = new Set([...raw.keys()].map((n) => n.split('/')[0]));
  const strip = tops.size === 1 && [...raw.keys()].every((n) => n.includes('/')) ? [...tops][0] + '/' : '';
  const base = new Map();
  for (const [n, s] of raw) base.set(strip && n.startsWith(strip) ? n.slice(strip.length) : n, s);
  if (strip) console.log(`（基线含顶层文件夹 ${strip}，已剥离）`);
  console.log(`基线条目：${base.size}`);

  const all = [];
  walk(ROOT, '', all);
  console.log(`当前文件：${all.length}`);

  const changed = [];
  for (const rel of all) {
    if (isSkipped(rel)) continue;
    const abs = path.join(ROOT, ...rel.split('/'));
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    const inBase = base.get(rel);
    if (inBase === undefined) { changed.push({ rel, why: '新增', size: st.size }); continue; }
    if (inBase !== st.size) { changed.push({ rel, why: `大小变化 ${inBase}→${st.size}`, size: st.size }); continue; }
    if (st.mtime > since) { changed.push({ rel, why: '修改时间较新', size: st.size }); continue; }
  }
  // 基线里有、现在没了的文件 → 只报告，不擅自删（覆盖包不删文件）
  const gone = [...base.keys()].filter((rel) => !fs.existsSync(path.join(ROOT, ...rel.split('/'))));

  changed.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  console.log(`\n=== 变化 ${changed.length} 个 ===`);
  let total = 0;
  for (const c of changed) { total += c.size; console.log(`  ${c.rel}  (${c.why}, ${(c.size / 1024).toFixed(1)} KB)`); }
  if (gone.length) {
    console.log(`\n=== 基线里有、现在已删除 ${gone.length} 个（覆盖包不会删，需要手动处理）===`);
    for (const g of gone.slice(0, 30)) console.log(`  ${g}`);
  }
  if (!changed.length) { console.log('\n没有变化，不需要热更包。'); return; }

  const out = path.resolve(arg('out', path.join(ROOT, '..', `Stronghold-hotfix-${new Date().toISOString().slice(0, 10)}.zip`)));
  const stage = path.join(ROOT, '.cache', 'hotfix-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  for (const c of changed) {
    const dst = path.join(stage, ...c.rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...c.rel.split('/')), dst);
  }
  fs.rmSync(out, { force: true });
  // 用参数直接传文件名（而不是 -T 列表文件）：Windows 下中文路径经 CreateProcessW 才是正确的 Unicode，
  // 走列表文件会按代码页解释，中文名会坏掉。
  const names = changed.map((c) => c.rel);
  const argvLen = names.reduce((s, n) => s + n.length + 3, 0);
  if (argvLen > 28000) throw new Error(`变化文件太多（${names.length} 个），请改用 --since 缩小范围，或先打一个中间基线包`);
  execFileSync('tar', ['-a', '-c', '-f', out, '--no-recursion', ...names], { cwd: stage, stdio: 'inherit' });
  fs.rmSync(stage, { recursive: true, force: true });

  const kb = fs.statSync(out).size / 1024;
  console.log(`\n热更包：${out}`);
  console.log(`  ${changed.length} 个文件，原始 ${(total / 1024).toFixed(1)} KB，压缩后 ${kb.toFixed(1)} KB`);
  console.log('  用法：覆盖解压到安装目录 → 重启启动器（启动器里也可以用「导入热更包」按键）');
}

main();
