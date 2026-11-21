// tools/zip-append.mjs — 往已有 zip「追加/替换」文件，**不重打整个包**。
//
//   node tools/zip-append.mjs --zip <目标.zip> --root <本地目录> --prefix <包内顶层目录> [--dry]
//
// 原理：zip 的结构是
//     [本地头+数据]×N  [中央目录]×M  [Zip64 EOCD]  [定位器]  [EOCD]
// 追加时只要：把新文件的数据写到「中央目录原来的位置」之后，再重写一份新的中央目录
// + 结尾记录。已有的文件数据**一个字节都不动**，所以 2.5 GB 的包也是秒级完成。
//
// 关键设计（避免同一个文件在包里出现两份）：
//   * 同名条目**从旧中央目录里剔除**，只保留新追加的那一条 —— 解压时拿到的必然是新版本；
//     旧条目数据变成文件里的孤儿（不影响任何解压器，只是浪费几十 KB）。
//   * 支持 Zip64（条目数 > 65535 或总长 > 4 GB），本项目的整包就是 Zip64。
//
// 备份：本工具**不会**自动备份，请在调用前自行复制一份目标 zip。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_Z64_LOC = 0x07064b50;

/** CRC32 查表（避免依赖 node 版本里的 zlib.crc32）。 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 读 EOCD / Zip64 EOCD，返回目录信息。 */
function readDirectory(fd) {
  const size = fs.fstatSync(fd).size;
  const tailLen = Math.min(size, 256 * 1024);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）');

  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOff = tail.readUInt32LE(eocd + 16);
  let zip64 = false;

  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
    zip64 = true;
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_Z64_LOC) { loc = i; break; }
    if (loc < 0) throw new Error('Zip64 包但找不到定位器');
    const z64Off = Number(tail.readBigUInt64LE(loc + 8));
    const hdr = Buffer.alloc(56);
    fs.readSync(fd, hdr, 0, 56, z64Off);
    if (hdr.readUInt32LE(0) !== SIG_Z64_EOCD) throw new Error('Zip64 EOCD 损坏');
    count = Number(hdr.readBigUInt64LE(32));
    cdSize = Number(hdr.readBigUInt64LE(40));
    cdOff = Number(hdr.readBigUInt64LE(48));
  }
  return { size, count, cdSize, cdOff, zip64 };
}

/** 解析中央目录 → [{ name, raw }]（raw 是该条目在 CD 里的原始字节）。 */
function parseCentralDirectory(fd, cdOff, cdSize) {
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOff);
  const out = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === SIG_CD) {
    const nlen = cd.readUInt16LE(p + 28);
    const elen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const total = 46 + nlen + elen + clen;
    const name = cd.subarray(p + 46, p + 46 + nlen).toString('utf8');
    out.push({ name, raw: cd.subarray(p, p + total) });
    p += total;
  }
  return out;
}

/** 构造一个新条目的本地头 + 中央目录记录。 */
function buildEntry(nameBuf, data, offset, crc) {
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const useStore = comp.length >= data.length;
  const body = useStore ? data : comp;
  const method = useStore ? 0 : 8;
  const flags = 0x0800; // 文件名是 UTF-8
  const dosTime = 0;    // 不写入具体时间，避免时区差异；解压器用默认值
  const dosDate = 0x21; // 1980-01-01

  // 本地文件头（若用到 Zip64 的 0xFFFFFFFF 占位，需要扩展字段承载真实大小）
  const needZip64 = data.length > 0xfffffffe || body.length > 0xfffffffe || offset > 0xfffffffe;
  const z64Extra = needZip64 ? (() => {
    const b = Buffer.alloc(4 + 24);
    b.writeUInt16LE(0x0001, 0);
    b.writeUInt16LE(24, 2);
    b.writeBigUInt64LE(BigInt(data.length), 4);
    b.writeBigUInt64LE(BigInt(body.length), 12);
    b.writeBigUInt64LE(BigInt(offset), 20);
    return b;
  })() : Buffer.alloc(0);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(SIG_LOCAL, 0);
  lh.writeUInt16LE(needZip64 ? 45 : 20, 4);      // version needed
  lh.writeUInt16LE(flags, 6);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(needZip64 ? 0xffffffff : body.length, 18);
  lh.writeUInt32LE(needZip64 ? 0xffffffff : data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(z64Extra.length, 28);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(SIG_CD, 0);
  cdh.writeUInt16LE((3 << 8) | 45, 4);           // made by: unix, 4.5
  cdh.writeUInt16LE(needZip64 ? 45 : 20, 6);
  cdh.writeUInt16LE(flags, 8);
  cdh.writeUInt16LE(method, 10);
  cdh.writeUInt16LE(dosTime, 12);
  cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(needZip64 ? 0xffffffff : body.length, 20);
  cdh.writeUInt32LE(needZip64 ? 0xffffffff : data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(z64Extra.length, 30);
  cdh.writeUInt16LE(0, 32);                       // comment len
  cdh.writeUInt16LE(0, 34);                       // disk
  cdh.writeUInt16LE(0, 36);                       // internal attrs
  cdh.writeUInt32LE(0, 38);                       // external attrs
  cdh.writeUInt32LE(needZip64 ? 0xffffffff : offset, 42);

  return {
    local: Buffer.concat([lh, nameBuf, z64Extra, body]),
    central: Buffer.concat([cdh, nameBuf, z64Extra]),
  };
}

/**
 * @param {{ zip: string, files: {entry: string, src: string}[], log?: any }} o
 */
export function appendToZip({ zip, files, log = console }) {
  const fd = fs.openSync(zip, 'r+');
  try {
    const dir = readDirectory(fd);
    const oldEntries = parseCentralDirectory(fd, dir.cdOff, dir.cdSize);
    const oldNames = new Set(oldEntries.map((e) => e.name));
    log.info?.(`原包：${dir.count} 条目，中央目录 ${(dir.cdSize / 1024 / 1024).toFixed(2)} MB，Zip64=${dir.zip64}`);

    // 新数据写在「旧中央目录起始位置」，覆盖它（内容已读进内存）
    let writeAt = dir.cdOff;
    const newCentrals = [];
    const replaced = new Set();
    let addedBytes = 0;
    for (const f of files) {
      const data = fs.readFileSync(f.src);
      const nameBuf = Buffer.from(f.entry, 'utf8');
      const crc = crc32(data);
      const built = buildEntry(nameBuf, data, writeAt, crc);
      fs.writeSync(fd, built.local, 0, built.local.length, writeAt);
      writeAt += built.local.length;
      addedBytes += built.local.length;
      newCentrals.push(built.central);
      if (oldNames.has(f.entry)) replaced.add(f.entry);
    }

    // 新中央目录 = 旧条目（剔除被替换的）+ 新条目
    const kept = oldEntries.filter((e) => !replaced.has(e.name));
    if (kept.length + newCentrals.length > 0xffff && !dir.zip64) {
      throw new Error('追加后条目数超过 65535，需要 Zip64；本包原本不是 Zip64，请改用重打');
    }
    const cdParts = [...kept.map((e) => e.raw), ...newCentrals];
    const cdBuf = Buffer.concat(cdParts);
    const newCdOff = writeAt;
    fs.writeSync(fd, cdBuf, 0, cdBuf.length, newCdOff);
    let tailAt = newCdOff + cdBuf.length;

    const total = kept.length + newCentrals.length;
    const needZip64 = dir.zip64 || total > 0xffff || newCdOff > 0xfffffffe;

    if (needZip64) {
      const z64 = Buffer.alloc(56);
      z64.writeUInt32LE(SIG_Z64_EOCD, 0);
      z64.writeBigUInt64LE(44n, 4);                 // size of remaining record
      z64.writeUInt16LE(45, 12);                    // version made by
      z64.writeUInt16LE(45, 14);                    // version needed
      z64.writeUInt32LE(0, 16);                     // disk
      z64.writeUInt32LE(0, 20);                     // cd disk
      z64.writeBigUInt64LE(BigInt(total), 24);
      z64.writeBigUInt64LE(BigInt(total), 32);
      z64.writeBigUInt64LE(BigInt(cdBuf.length), 40);
      z64.writeBigUInt64LE(BigInt(newCdOff), 48);
      fs.writeSync(fd, z64, 0, z64.length, tailAt);
      tailAt += z64.length;

      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(SIG_Z64_LOC, 0);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(tailAt - 56), 8);
      loc.writeUInt32LE(1, 16);
      fs.writeSync(fd, loc, 0, loc.length, tailAt);
      tailAt += loc.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(total, 0xffff), 8);
    eocd.writeUInt16LE(Math.min(total, 0xffff), 10);
    eocd.writeUInt32LE(needZip64 ? 0xffffffff : cdBuf.length, 12);
    eocd.writeUInt32LE(needZip64 ? 0xffffffff : newCdOff, 16);
    eocd.writeUInt16LE(0, 20);
    fs.writeSync(fd, eocd, 0, eocd.length, tailAt);
    tailAt += eocd.length;

    fs.ftruncateSync(fd, tailAt);
    log.info?.(`追加 ${files.length} 个（其中替换 ${replaced.size} 个），新条目 ${total}，文件长度 ${(tailAt / 1024 / 1024).toFixed(1)} MB`);
    return { total, replaced: [...replaced], added: files.length, size: tailAt, addedBytes };
  } finally {
    fs.closeSync(fd);
  }
}

/** 命令行入口：比对 zip 与本地目录，把有差异的文件追加进去。 */
function main() {
  const arg = (n, d = null) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
  };
  const zip = arg('zip');
  const root = arg('root');
  const prefix = (arg('prefix', '') || '').replace(/\/+$/, '');
  const dry = process.argv.includes('--dry');
  const onlyRaw = arg('only');   // 逗号分隔的白名单（相对 root 的路径）
  // 白名单太长（几千个文件）会超过命令行长度上限，用 --only-file 从文件读，再拼回逗号串
  const onlyFile = arg('only-file');
  const only = onlyFile
    ? fs.readFileSync(onlyFile, 'utf8').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean).join(',')
    : onlyRaw;
  if (!zip || !root) {
    console.error('用法: node tools/zip-append.mjs --zip <a.zip> --root <dir> --prefix <包内顶层目录> [--only a,b | --only-file list.txt] [--dry]');
    process.exit(2);
  }

  // 读 zip 现有条目大小，和磁盘比对
  const fd = fs.openSync(zip, 'r');
  let dir;
  let entries;
  try {
    dir = readDirectory(fd);
    entries = parseCentralDirectory(fd, dir.cdOff, dir.cdSize);
  } finally { fs.closeSync(fd); }
  const byName = new Map(entries.map((e) => [e.name, e]));

  const want = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const changed = [];

  // 白名单模式：直接按清单取文件，不遍历整棵目录（6 万文件要扫半分钟，没必要）
  if (want) {
    for (const rel of want) {
      const src = path.join(root, ...rel.split('/'));
      let st;
      try { st = fs.statSync(src); } catch { console.log(`  跳过（本地不存在）${rel}`); continue; }
      if (!st.isFile()) { console.log(`  跳过（不是文件）${rel}`); continue; }
      const entry = prefix ? `${prefix}/${rel}` : rel;
      changed.push({ entry, src, why: '白名单' });
    }
  } else {
  const walk = (d, rel) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (['.cache', '.git', 'merge-shots', 'node_modules', 'webview2'].includes(e.name)) continue;
        walk(path.join(d, e.name), childRel);
      } else if (e.isFile()) {
        const entry = prefix ? `${prefix}/${childRel}` : childRel;
        const src = path.join(d, e.name);
        const st = fs.statSync(src);
        const old = byName.get(entry);
        if (!old) { changed.push({ entry, src, why: '新增' }); continue; }
        const oldSize = old.raw.readUInt32LE(24);
        if (oldSize !== st.size) { changed.push({ entry, src, why: `大小 ${oldSize}→${st.size}` }); continue; }
      }
    }
  };
  walk(root, '');
  }

  console.log(`差异 ${changed.length} 个：`);
  for (const c of changed.slice(0, 40)) console.log(`  ${c.why}  ${c.entry}`);
  if (changed.length > 40) console.log(`  … 其余 ${changed.length - 40} 个`);
  if (!changed.length) { console.log('没有差异。'); return; }
  if (dry) { console.log('--dry：未写入。'); return; }

  const r = appendToZip({ zip, files: changed.map(({ entry, src }) => ({ entry, src })) });
  console.log(`完成：条目 ${r.total}，替换 ${r.replaced.length}，文件 ${(r.size / 1024 / 1024).toFixed(1)} MB`);
}

if (process.argv[1] && process.argv[1].endsWith('zip-append.mjs')) main();
