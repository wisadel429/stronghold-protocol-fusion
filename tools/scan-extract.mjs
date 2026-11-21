// tools/scan-extract.mjs — 扫描「卫戍协议规程_完整解包」进度，输出分类统计与关键文件是否到位。
// 用法：node tools/scan-extract.mjs [目录]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'E:/stronghold/卫戍协议规程_完整解包';
const FLAGS = {
  gamedata: /gamedata|excel|activity_table|character_table|skill_table|enemy_table|stage_table|item_table/i,
  autochess: /autochess/i,
  maps: /mappreview|level_act3|scenes[\\/]activities|levelprefabs/i,
  ui: /[\\/]ui[\\/]|autochessouter|autochessbattle|autochesscommon|templateshop/i,
  audio: /\.(ogg|mp3|wav|m4a)$/i,
  spine: /\.(skel|atlas)$/i,
  images: /\.(png|webp|jpg|jpeg)$/i,
};

function walk(dir, out = { files: 0, bytes: 0, ext: new Map(), top: new Map(), newest: null, flags: Object.fromEntries(Object.keys(FLAGS).map((k) => [k, 0])) }) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    let st; try { st = fs.statSync(p); } catch { continue; }
    out.files++; out.bytes += st.size;
    const rel = path.relative(ROOT, p);
    const ext = path.extname(e.name).toLowerCase() || '(none)';
    out.ext.set(ext, (out.ext.get(ext) || 0) + 1);
    const top = rel.split(path.sep)[0];
    const t = out.top.get(top) || { files: 0, bytes: 0 };
    t.files++; t.bytes += st.size; out.top.set(top, t);
    if (!out.newest || st.mtimeMs > out.newest.mtimeMs) out.newest = { rel, mtime: st.mtime, size: st.size };
    for (const [k, re] of Object.entries(FLAGS)) if (re.test(rel)) out.flags[k]++;
  }
  return out;
}

const s = walk(ROOT);
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const lines = [];
lines.push(`扫描目录：${ROOT}`);
lines.push(`文件 ${s.files} 个，合计 ${mb(s.bytes)}`);
lines.push('');
lines.push('按顶层目录：');
for (const [k, v] of [...s.top.entries()].sort((a, b) => b[1].files - a[1].files)) lines.push(`  ${k}: ${v.files} 个 / ${mb(v.bytes)}`);
lines.push('');
lines.push('扩展名：' + [...s.ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k} ${n}`).join('，'));
lines.push('');
lines.push('关键内容是否出现：' + Object.entries(s.flags).map(([k, n]) => `${k}=${n}`).join('，'));
lines.push('');
lines.push('最新文件：' + (s.newest ? `${s.newest.rel}（${s.newest.mtime.toLocaleString('zh-CN')}，${(s.newest.size / 1024).toFixed(0)} KB）` : '无'));
const outPath = 'E:/stronghold/shots/extract-progress.txt';
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(lines.join('\n'));
