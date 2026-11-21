// tools/vault.mjs — 用口令加密 / 解密单个文件（AES-256-GCM + scrypt）。
//
//   node tools/vault.mjs enc <明文文件> <口令> [输出文件]
//   node tools/vault.mjs dec <密文文件> <口令> [输出文件]     # 不给输出文件就打到 stdout
//   node tools/vault.mjs chk <密文文件>                        # 只校验格式，不需要口令
//
// 用途（业主 2026-11-15）：交接文档里有后台口令，明文放磁盘不安全。
// 加密成 .enc 后，明文里只留「见 xxx.enc」，需要时用一条命令解出来看。
//
// 文件格式：
//   "SPVAULT1" | salt(16) | iv(12) | authTag(16) | ciphertext
//   密钥 = scrypt(口令, salt, 32)，AES-256-GCM 带认证，改一个字节解不开。

import fs from 'node:fs';
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const MAGIC = Buffer.from('SPVAULT1', 'utf8');
const [cmd, file, pass, out] = process.argv.slice(2);

if (cmd === 'chk') {
  if (!file || !fs.existsSync(file)) { console.error('文件不存在'); process.exit(2); }
  const buf = fs.readFileSync(file);
  const ok = buf.length > 52 && buf.subarray(0, 8).equals(MAGIC);
  console.log(ok ? `格式正确：${file}（${buf.length} 字节密文）` : '格式不对：不是本工具生成的密文');
  process.exit(ok ? 0 : 1);
}

if (!cmd || !file || !pass) {
  console.error('用法:\n  node tools/vault.mjs enc <明文> <口令> [输出]\n  node tools/vault.mjs dec <密文> <口令> [输出]\n  node tools/vault.mjs chk <密文>');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error('文件不存在: ' + file); process.exit(2); }

const KEY_LEN = 32;

if (cmd === 'enc') {
  const plain = fs.readFileSync(file);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, KEY_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const outFile = out || file + '.enc';
  fs.writeFileSync(outFile, Buffer.concat([MAGIC, salt, iv, tag, body]));
  console.log(`已加密：${file}（${plain.length} 字节） → ${outFile}（${fs.statSync(outFile).size} 字节）`);
  process.exit(0);
}

if (cmd === 'dec') {
  const buf = fs.readFileSync(file);
  if (buf.length <= 52 || !buf.subarray(0, 8).equals(MAGIC)) { console.error('不是本工具生成的密文'); process.exit(2); }
  const salt = buf.subarray(8, 24);
  const iv = buf.subarray(24, 36);
  const tag = buf.subarray(36, 52);
  const body = buf.subarray(52);
  try {
    const key = scryptSync(pass, salt, KEY_LEN);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(body), d.final()]);
    if (out) { fs.writeFileSync(out, plain); console.log(`已解密 → ${out}（${plain.length} 字节）`); }
    else process.stdout.write(plain);
    process.exit(0);
  } catch {
    console.error('解密失败：口令不对，或文件被改过');
    process.exit(1);
  }
}

console.error('未知命令: ' + cmd);
process.exit(2);
