// tools/encrypt-art.mjs — 把美术资源「落盘加密」，配合 server/http/artLock.js 在服务端透明解密。
//
//   node tools/encrypt-art.mjs                    # 默认加密 public/assets/char
//   node tools/encrypt-art.mjs --dirs char,spine  # 指定目录（相对 public/assets/）
//   node tools/encrypt-art.mjs --decrypt          # 反向：解密回去（改 bug / 回滚用）
//   node tools/encrypt-art.mjs --dry              # 只统计，不写文件
//
// 密钥：data/art-key.json（base64 的 32 字节）。第一次运行自动生成 —— **这个文件必须保管好，丢了资源就解不开**。
// 幂等：已经有 `SPLOCK1` 头的文件会跳过，所以可以反复跑、分批加密。
//
// 为什么不加密音频：音频要支持 HTTP Range（拖进度条），加密后字节偏移会错位。

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ROOT = process.cwd();
const MAGIC = Buffer.from('SPLOCK1', 'utf8');
const HDR = 7 + 12 + 16;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const dirs = opt('--dirs', 'char').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = flag('--dry');
const DECRYPT = flag('--decrypt');

// ---- 密钥 ----
const keyFile = path.join(ROOT, 'data', 'art-key.json');
let key = null;
if (fs.existsSync(keyFile)) {
  try {
    const j = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const b = Buffer.from(j.key, 'base64');
    if (b.length === 32) key = b;
  } catch { /* 下面重建 */ }
}
if (!key) {
  if (DECRYPT) { console.error('data/art-key.json 不存在，无法解密'); process.exit(2); }
  key = randomBytes(32);
  if (!DRY) {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, JSON.stringify({ v: 1, key: key.toString('base64'), madeAt: new Date().toISOString() }, null, 2), 'utf8');
    console.log(`已生成密钥：${keyFile}`);
    console.log(`  ⚠ 这个文件千万不要丢、也不要发出去 —— 丢了所有加密过的资源都解不开`);
  }
}

const isEnc = (buf) => buf.length > HDR && buf.subarray(0, 7).equals(MAGIC);

function enc(buf) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function dec(buf) {
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(7, 19));
  d.setAuthTag(buf.subarray(19, 35));
  return Buffer.concat([d.update(buf.subarray(35)), d.final()]);
}

const SKIP_EXT = new Set(['.m4a', '.mp3', '.ogg', '.wav', '.mp4', '.webm']); // 音频/视频有 Range，不动

let done = 0, skipped = 0, failed = 0, bytes = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (SKIP_EXT.has(ext)) { skipped++; continue; }
    let buf;
    try { buf = fs.readFileSync(p); } catch { failed++; continue; }
    const already = isEnc(buf);
    if (DECRYPT && !already) { skipped++; continue; }
    if (!DECRYPT && already) { skipped++; continue; }
    let out;
    try { out = DECRYPT ? dec(buf) : enc(buf); } catch (err) {
      console.error(`  ✗ ${path.relative(ROOT, p)}: ${err.message}`);
      failed++;
      continue;
    }
    if (!DRY) fs.writeFileSync(p, out);
    done++; bytes += out.length;
    if (done % 200 === 0) process.stdout.write(`\r  ${DECRYPT ? '解密' : '加密'}中… ${done} 个，${(bytes / 1048576).toFixed(0)} MB`);
  }
}

const t0 = Date.now();
for (const d of dirs) {
  const abs = path.join(ROOT, 'public', d.startsWith('ui-art/') ? d : path.join('assets', d));
  if (!fs.existsSync(abs)) { console.log(`跳过（不存在）：public/assets/${d}`); continue; }
  console.log(`处理 public/assets/${d}/ …`);
  walk(abs);
}
const sec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${DECRYPT ? '解密' : '加密'}完成：${done} 个文件，${(bytes / 1048576).toFixed(1)} MB，跳过 ${skipped}，失败 ${failed}，用时 ${sec}s${DRY ? '（dry：没有写盘）' : ''}`);
if (failed) process.exit(1);
