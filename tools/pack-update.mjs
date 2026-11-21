// tools/pack-update.mjs — 生成热更包（增量更新包）用的打包器。
//
// 背景：整包 3.8 GB / 6.3 万文件，每次重打太慢；而 server/update.js 的既有机制只需要
//   「变化的文件 + 新的 MANIFEST.json + UPDATE.json」这一小包，覆盖解压后服务器自己校验并应用。
// 本工具补上被裁掉的 tools/package.mjs --update 那一半：
//
//   node tools/pack-update.mjs                       # 以安装里的 MANIFEST.json 为基线
//   node tools/pack-update.mjs --version 0.3.3-Yuan.1
//   node tools/pack-update.mjs --base D:\old\MANIFEST.json --out D:\patch.zip
//   node tools/pack-update.mjs --dry                 # 只报告差异，不写文件
//
// 产物：<out>（默认 ..\Stronghold-Protocol-v<version>-update.zip），以及
//       ..\_patches\<version>\MANIFEST.json（基线留档，方便回滚 / 下次对账）。
//
// 规则与 server/update.js 完全一致：美术文件（public/assets、public/fonts、data/assets.json、
// data/local-assets.json、data/local-fx.json）不进 MANIFEST，只在整包里；每次安装后
// 安装目录的 MANIFEST.json 就是新基线，所以这条循环是自维持的。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILE, UPDATE_FILE, UPDATE_FORMAT, inManifest, digestFile, parseManifest, isSetupArt,
} from '../server/update.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 整棵跳过（纯缓存 / 产物 / 美术，美术不进 MANIFEST） */
const SKIP_DIRS = new Set(['.cache', '.git', 'merge-shots', 'logs', 'node_modules/.cache']);
const SKIP_TOP = new Set(['public/assets', 'public/fonts']);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

/** 走一遍安装目录，返回相对路径（`/` 分隔）→ 绝对路径。跳过美术与缓存。 */
function walk(root) {
  const out = [];
  const rec = (dir, rel) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(childRel) || SKIP_TOP.has(childRel)) continue;
        rec(path.join(dir, e.name), childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  };
  rec(root, '');
  return out;
}

const bytes = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function main() {
  const dry = has('dry');
  const baseFile = path.resolve(arg('base', path.join(ROOT, MANIFEST_FILE)));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = arg('version', pkg.version);

  if (!fs.existsSync(baseFile)) {
    console.error(`找不到基线 MANIFEST：${baseFile}`);
    console.error('（整包安装一定有它；源码 checkout 没有，需要先用 --base 指定一个已知基线）');
    process.exit(2);
  }
  const base = parseManifest(fs.readFileSync(baseFile, 'utf8'));
  console.log(`基线：v${base.app}，${base.files.size} 个文件  (${baseFile})`);
  console.log(`新版本：v${version}`);

  // 1) 当前树里「该进 MANIFEST」的文件及摘要
  const now = new Map();
  let scanned = 0;
  for (const rel of walk(ROOT)) {
    if (rel === MANIFEST_FILE || rel === UPDATE_FILE || rel === '.update-applied.json') continue;
    if (isSetupArt(rel) || !inManifest(rel)) continue;
    scanned++;
    const d = digestFile(path.join(ROOT, rel));
    if (d) now.set(rel, d);
  }

  // 2) 差异
  const changed = [];
  for (const [rel, d] of now) {
    const old = base.files.get(rel);
    if (!old || old.size !== d.size || old.sha256 !== d.sha256) changed.push(rel);
  }
  const removed = [];
  for (const [rel, old] of base.files) {
    if (!now.has(rel)) removed.push({ path: rel, sha256: [old.sha256] });
  }
  changed.sort();
  removed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const changedBytes = changed.reduce((s, r) => s + now.get(r).size, 0);
  console.log(`扫描 ${scanned} 个受管文件（美术已排除）`);
  console.log(`变化 ${changed.length} 个（${mb(changedBytes)}），删除 ${removed.length} 个`);

  if (changed.length === 0 && removed.length === 0) {
    console.log('没有差异，无需热更包。');
    return;
  }
  if (changed.length) {
    console.log('--- 变化清单 ---');
    for (const r of changed.slice(0, 60)) console.log(`  M ${r}  (${bytes(now.get(r).size)})`);
    if (changed.length > 60) console.log(`  … 其余 ${changed.length - 60} 个`);
  }
  if (removed.length) {
    console.log('--- 删除清单 ---');
    for (const r of removed.slice(0, 30)) console.log(`  D ${r.path}`);
    if (removed.length > 30) console.log(`  … 其余 ${removed.length - 30} 个`);
  }
  if (dry) { console.log('\n--dry：没有写任何文件。'); return; }

  // 3) 新的 MANIFEST.json 与 UPDATE.json（写入暂存目录，再打进 zip）
  const stage = path.join(ROOT, '.cache', 'update-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const manifest = { format: UPDATE_FORMAT, app: version, files: Object.fromEntries([...now].sort(([a], [b]) => (a < b ? -1 : 1))) };
  fs.writeFileSync(path.join(stage, MANIFEST_FILE), JSON.stringify(manifest));

  const update = {
    format: UPDATE_FORMAT,
    app: version,
    from: [base.app],
    count: changed.length,
    bytes: changedBytes,
    files: Object.fromEntries(changed.map((r) => [r, now.get(r)])),
    removed,
  };
  fs.writeFileSync(path.join(stage, UPDATE_FILE), JSON.stringify(update));

  // 4) 只把变化文件搬进暂存目录（保留相对路径），再整目录打 zip
  for (const rel of changed) {
    const dst = path.join(stage, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }

  const out = path.resolve(arg('out', path.join(ROOT, '..', `Stronghold-Protocol-v${version}-update.zip`)));
  fs.rmSync(out, { force: true });
  const listFile = path.join(stage, '.payload.txt');
  const payload = [];
  for (const rel of changed) payload.push(rel);
  payload.push(MANIFEST_FILE, UPDATE_FILE);
  fs.writeFileSync(listFile, payload.join('\n'), 'utf8');
  execFileSync('tar', ['-a', '-c', '-f', out, '-T', listFile, '--no-recursion'], { cwd: stage, stdio: 'inherit' });
  fs.rmSync(listFile, { force: true });

  // 5) 基线留档
  const keepDir = path.join(ROOT, '..', '_patches', version);
  fs.mkdirSync(keepDir, { recursive: true });
  fs.copyFileSync(path.join(stage, MANIFEST_FILE), path.join(keepDir, MANIFEST_FILE));
  fs.copyFileSync(path.join(stage, UPDATE_FILE), path.join(keepDir, UPDATE_FILE));

  const zipMB = fs.statSync(out).size / 1024 / 1024;
  console.log(`\n更新包：${out}`);
  console.log(`  内容 ${changed.length + 2} 项（含 MANIFEST.json / UPDATE.json），压缩后 ${zipMB.toFixed(2)} MB`);
  console.log(`  基线副本：${path.join(keepDir, MANIFEST_FILE)}`);
  console.log('\n分发与安装：');
  console.log(`  1. 玩家停服，把这个 zip 覆盖解压到安装目录（会替换 MANIFEST.json、写入 UPDATE.json）`);
  console.log(`  2. 重新启动服务器：applyPendingUpdate 校验通过后自动删旧文件、完成更新`);
  console.log(`  3. 校验失败会拒绝启动（说明安装不是 v${base.app}）——此时请用整包`);
}

main();
