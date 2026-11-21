// public/js/ui/cardArt.js — 名片立绘微调（业主 2026-10-28 A 项；2026-11-02 修「显示不全 / 精二画成皮肤」）
//
// 座位卡上的立绘按本机 pref room.cardArt 的「每个干员一条」设置来画：
//   · 版本 art：'e1' = 干员自己的精一全幅立绘（清单 chars[].illustE1）、'e2' = 精二全幅立绘（chars[].illust）、
//     'skin' = 所穿外观自己的立绘（chars[].skins[skinId].illust）、'auto' = 没手动选过 —— 穿了带立绘的外观就画
//     外观，否则精二。
//     **精一从清单读**，不再按精二的扩展名去推 _1：旧写法（illust.webp ⇒ <id>_1.webp）在「精二是 .png、精一却是
//     .webp」（或反过来）的 24 名干员上 404，点了精一看到的还是精二。
//     **穿了皮肤时精一/精二都指向皮肤**（旧 illustUrl 先取 skin.illust，artSrcOf 又没法把皮肤拆开）。现在版本是
//     三选一（面板里多一个「皮肤」按钮），精一/精二永远只画干员本体的立绘。
//   · 取景：**完整显示**。座位卡的画面框是竖长的（桌面约 232×560），精二立绘却是近方形的大图 —— 旧的
//     object-fit: cover 只露出画面中间 24%–38%，人物和背景两侧被裁掉，业主看到的就是「立绘显示不全」。现在把
//     **内容框**（先用 64px 缩略图量掉透明留白，精一那种 1024×1024 带空白边的画布才不会缩成中间一小条）等比缩进
//     框里，空出来的地方用同一张图的虚化版本铺满。缩放 0.8–2.0× 与框内拖拽平移照旧，放大到 1× 以上才会开始裁边。
//     面板里还有一组「完整 / 填满」（fit）：完整 = 上面这套（默认，谁都不裁），填满 = 内容框铺满画面框、边缘照旧
//     裁掉（旧的 cover 观感），按干员分别记住。
//   · 持久化：本机 pref room.cardArt = { [charId]: { art, zoom, ox, oy } }。**刻意不并进 CARD_PREF** ——
//     那份是「玩家选了哪个干员」（room.card { charId, skin }，服务端已收），改形状会动到同步链；而位置/缩放
//     **服务端字段待定**（engine-core 未给），所以先只存本机，等协议再一起发。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

let cssLoaded = false;
/** 本模块的样式（与 ui/forge.js / ui/jibian.js 同一个懒加载写法；不进 index.html）。 */
export function ensureCardArtCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-cardart]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/card-art.css';
  link.dataset.cardart = '1';
  document.head.appendChild(link);
}

/** 立绘微调的本机 pref（按 charId 分条，互不影响）。 */
export const CARD_ART_PREF = 'room.cardArt';
/** 中立值：跟着外观走（没穿外观 = 精二）/ 完整显示 / 1.0× / 居中。 */
export const CARD_ART_DEFAULT = Object.freeze({ art: 'auto', skin: null, fit: 'full', zoom: 1, ox: 0, oy: 0 });
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 2;
/** 版本（立绘来源）：auto = 穿外观就外观、否则精二。 */
export const ARTS = Object.freeze(['e1', 'e2', 'skin']);
/** 取景：full = 整幅缩进框里（不裁）、fill = 铺满框（边缘裁掉）。 */
export const FITS = Object.freeze(['full', 'fill']);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const round2 = (v) => Math.round(v * 100) / 100;

/** 一条存下来的立绘设置（坏值一律回中立值）。ox/oy 是**框宽的百分比整数**（-100..100），可反复往返。 */
export function normalizeCardArt(v) {
  const o = v && typeof v === 'object' ? v : {};
  // 缺字段 / 坏字段一律回中立值（clamp(undefined) 会落到下界，那是 0.8× / -100% 的坑）
  const num = (x, def) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : def);
  return {
    art: ARTS.includes(o.art) ? o.art : 'auto',
    // art === 'skin' 时画**哪一套**皮肤（skinId）；空 = 跟着穿的那套 / 没有就退精二
    skin: typeof o.skin === 'string' && o.skin ? o.skin : null,
    fit: FITS.includes(o.fit) ? o.fit : 'full',
    zoom: round2(clamp(num(o.zoom, CARD_ART_DEFAULT.zoom), ZOOM_MIN, ZOOM_MAX)),
    ox: Math.round(clamp(num(o.ox, 0), -100, 100)),
    oy: Math.round(clamp(num(o.oy, 0), -100, 100)),
  };
}

function readAll() {
  try {
    const raw = loadPref(CARD_ART_PREF, null);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/** 某个干员的立绘设置（没存过 = 中立值）。 */
export const cardArtOf = (charId) => normalizeCardArt(readAll()[charId]);

/**
 * 存某个干员的一处设置：{ art?, zoom?, ox?, oy? } 与现值合并后写回。
 * @param {string} charId @param {Partial<{art:'auto'|'e1'|'e2'|'skin', zoom:number, ox:number, oy:number}>} patch
 */
export function setCardArt(charId, patch) {
  if (!charId) return;
  const all = readAll();
  const next = { ...all, [charId]: normalizeCardArt({ ...cardArtOf(charId), ...patch }) };
  try { savePref(CARD_ART_PREF, next); } catch { /* 隐私模式：本次会话里仍然生效 */ }
  return next[charId];
}

/** 重置回中立值（跟外观走 / 1.0× / 居中）。 */
export const resetCardArt = (charId) => setCardArt(charId, CARD_ART_DEFAULT);

/**
 * 这个干员能画的几套立绘：精一 / 精二 / 每一套带立绘的皮肤。由调用方从清单解出来
 * （public/js/assets.js illustSources），本模块只认这个形状，纯函数才好测。
 * @typedef {{ e1?: string|null, e2?: string|null, skin?: string|null,
 *   skins?: { id: string, name?: string, src: string }[] }} ArtSources
 * @param {ArtSources|null} sources
 * @param {'auto'|'e1'|'e2'|'skin'} art
 * @param {string|null} [skinId] art === 'skin' 时画哪一套（空 = 穿的那套，再没有就退精二）
 * @returns {{ art: 'e1'|'e2'|'skin', skinId: string|null, src: string|null, chain: string[] }}
 *   art 是**实际画出来的**那套（回落之后），skinId 是实际画出来的那套皮肤，chain 是依次尝试的地址。
 */
export function artPlan(sources, art, skinId = null) {
  const s = sources && typeof sources === 'object' ? sources : {};
  const e1 = typeof s.e1 === 'string' && s.e1 ? s.e1 : null;
  const e2 = typeof s.e2 === 'string' && s.e2 ? s.e2 : null;
  const worn = typeof s.skin === 'string' && s.skin ? s.skin : null;
  const list = Array.isArray(s.skins) ? s.skins : [];
  const wantSkin = typeof skinId === 'string' && skinId ? list.find((x) => x && x.id === skinId) : null;
  const skin = (wantSkin && typeof wantSkin.src === 'string' && wantSkin.src) || worn;
  const want = ARTS.includes(art) ? art : 'auto';
  // auto：穿了带立绘的外观就画外观，否则精二
  const first = want === 'auto' ? (worn ? 'skin' : 'e2') : want;
  const order = first === 'e1' ? [e1, e2, skin] : first === 'skin' ? [skin, e2, e1] : [e2, e1, skin];
  const chain = order.filter((u) => typeof u === 'string' && u).filter((u, i, a) => a.indexOf(u) === i);
  const src = chain[0] || null;
  const shownSkin = src !== null && src === skin ? (wantSkin && wantSkin.src === src ? wantSkin.id : skinIdOf(list, src)) : null;
  return {
    art: src !== null && src === skin ? 'skin' : src !== null && src === e1 ? 'e1' : 'e2',
    skinId: src !== null && src === skin ? shownSkin : null,
    src,
    chain,
  };
}

/** 清单里哪个皮肤 id 的立绘是这个地址（都没有 = null）。 */
function skinIdOf(list, src) {
  for (const x of list) if (x && x.src === src && typeof x.id === 'string') return x.id;
  return null;
}

// ---- 取景：把内容框等比放进画面框 ---------------------------------------------------------------------------
// 透明留白先量掉（精一的 1024×1024 画布常带大片空白边），再把量出来的内容框等比缩到框内 —— 「完整显示」。
// 量法：64px 缩略图扫 alpha 包围盒，结果按 src 缓存在内存里（一页最多十几张，够快；不落盘，换图即失效）。

/** src -> {x,y,w,h}（0..1 的相对内容框）| null。 */
const BOX_CACHE = new Map();
/** 测试用：清掉量过的内容框。 */
export function clearArtBoxCache() { BOX_CACHE.clear(); }

/** 在 64px 缩略图上扫 alpha 包围盒（量不出来 = null，按整幅算）。 */
export function measureContentBox(img) {
  const nw = Number(img?.naturalWidth) || 0;
  const nh = Number(img?.naturalHeight) || 0;
  if (!(nw > 0) || !(nh > 0) || typeof document === 'undefined') return null;
  try {
    const W = 64;
    const H = Math.max(8, Math.min(256, Math.round((64 * nh) / nw)));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.clearRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (d[(y * W + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0 || y1 < y0) return null;
    return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
  } catch { return null; }
}

/** 内容框换成自然像素（量不出来 = 整幅）。 */
export function contentBox(nat, box) {
  const w = Number(nat?.w) || 0;
  const h = Number(nat?.h) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const b = box && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(box[k]))
    ? box
    : { x: 0, y: 0, w: 1, h: 1 };
  const bw = Math.min(1, Math.max(0.01, b.w));
  const bh = Math.min(1, Math.max(0.01, b.h));
  const bx = Math.min(Math.max(0, b.x), 1 - bw);
  const by = Math.min(Math.max(0, b.y), 1 - bh);
  return { x: bx * w, y: by * h, w: bw * w, h: bh * h };
}

/**
 * 一张图在画面框里的几何：内容框等比缩进框内（缩放/平移照旧），返回 img 的 px 尺寸与位置。
 * 框或图还没量出来 = null（调用方退回 object-fit: contain）。
 * @param {{ nat?: {w:number,h:number}|null, box?: any, frame?: {w:number,h:number}|null,
 *   fit?: 'full'|'fill', zoom?: number, ox?: number, oy?: number }} p
 *   fit：'full' = 整幅缩进框里（min，1× 时四边留白）、'fill' = 铺满框（max，1× 时裁掉超出部分）
 * @returns {{ w:number, h:number, left:number, top:number, scale:number }|null}
 */
export function artFit({ nat = null, box = null, frame = null, fit = 'full', zoom = CARD_ART_DEFAULT.zoom, ox = 0, oy = 0 } = {}) {
  const c = contentBox(nat, box);
  const fw = Number(frame?.w) || 0;
  const fh = Number(frame?.h) || 0;
  if (!c || !(fw > 0) || !(fh > 0)) return null;
  const z = clamp(Number(zoom), ZOOM_MIN, ZOOM_MAX);
  const scales = [fw / c.w, fh / c.h];
  const scale = (fit === 'fill' ? Math.max(...scales) : Math.min(...scales)) * z;
  return {
    w: nat.w * scale,
    h: nat.h * scale,
    left: (fw - c.w * scale) / 2 - c.x * scale + (clamp(Number(ox), -100, 100) / 100) * fw,
    top: (fh - c.h * scale) / 2 - c.y * scale + (clamp(Number(oy), -100, 100) / 100) * fh,
    scale,
  };
}

/** artFit 的结果 -> 内联 style（图按 px 摆，object-fit 不再参与裁剪）。 */
export function artBoxStyle(fit) {
  if (!fit) return 'width: 100%; height: 100%; left: 0; top: 0; object-fit: contain;';
  const r = (n) => Math.round(n * 100) / 100;
  return [`width: ${r(fit.w)}px; height: ${r(fit.h)}px; left: ${r(fit.left)}px; top: ${r(fit.top)}px; object-fit: fill;`].join('');
}

// ---- 画面框的量尺 -------------------------------------------------------------------------------------------

/** 画面框的像素尺寸（ResizeObserver；不支持就退到 window resize）。 */
function useFrameSize(frameRef) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = frameRef && frameRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    return undefined;
  }, [frameRef]);
  return size;
}

/**
 * 画面框里的两层图：底下是同一张图的**虚化铺满**（框比图长很多时，空出来的地方不至于是一块纯色），
 * 上面是按 artFit 摆好、完整显示的那张。onLoad 时量内容框。
 */
function ArtPicture({ src, value, frameRef, className = '', dataArt = null, onError = null }) {
  const v = normalizeCardArt(value);
  const size = useFrameSize(frameRef);
  const [nat, setNat] = useState(null);
  const [box, setBox] = useState(null);
  useEffect(() => { setNat(null); setBox(null); }, [src]);
  const fit = artFit({ nat, box, frame: size, fit: v.fit, zoom: v.zoom, ox: v.ox, oy: v.oy });
  const onLoad = (e) => {
    const img = e && e.currentTarget;
    if (!img) return;
    setNat({ w: Number(img.naturalWidth) || 0, h: Number(img.naturalHeight) || 0 });
    if (BOX_CACHE.has(src)) { setBox(BOX_CACHE.get(src)); return; }
    const measured = measureContentBox(img);
    BOX_CACHE.set(src, measured);
    setBox(measured);
  };
  return html`<img class="cardart__bg" src=${src} alt="" aria-hidden="true" draggable=${false} />
    <img class=${[`cardart__img ${className}`]} src=${src} alt="" draggable=${false} data-art=${dataArt}
      style=${artBoxStyle(fit)} onLoad=${onLoad} onError=${onError} />`;
}

/**
 * 立绘调整的**纯视图**（测试直接当函数画；拖拽/滚轮/双指的监听由 CardArt 挂）。
 * 版本三选一：精一 / 精二 / 皮肤（穿了带立绘的外观才有「皮肤」这一项）。
 * 版面按业主 2026-11-02 的要求：**先看/选干员，再选这一张画哪套图**——干员一行的「更换立绘」回到名片干员选择，
 * 下面是这个干员能画的全部立绘：精一 / 精二 / **每一套带立绘的皮肤各占一颗按钮，用皮肤名简称**。
 * @param {{ charId: string, sources?: ArtSources|null, operator?: string|null, value?: any,
 *   onVersion?: (key: 'e1'|'e2'|string) => void, onPickOperator?: (() => void)|null, onFit?: (m: 'full'|'fill') => void,
 *   onZoom?: (z: number) => void, onReset?: () => void, onBroken?: () => void, frameRef?: any }} props
 */
export function CardArtView({ charId, sources = null, operator = null, value = CARD_ART_DEFAULT,
  onVersion = () => {}, onPickOperator = null, onFit = () => {}, onZoom = () => {}, onReset = () => {}, onBroken = () => {}, frameRef = null }) {
  ensureCardArtCss();
  const v = normalizeCardArt(value);
  const plan = artPlan(sources, v.art, v.skin);
  const skins = Array.isArray(sources?.skins) ? sources.skins : [];
  // 每颗按钮的 key：'e1' / 'e2' / 'skin:<skinId>'（多套皮肤各占一颗，用名字分开）
  const options = [['e1', t('精一')], ['e2', t('精二')],
    ...skins.map((x) => [`skin:${x.id}`, x.name || t('皮肤')])];
  const activeKey = plan.art === 'skin' && plan.skinId ? `skin:${plan.skinId}` : plan.art;
  return html`<section class="cardart" data-testid="card-art" data-art=${plan.art} data-char=${charId || null}>
    <header class="cardart__head">
      <span class="cardart__title">${t('立绘调整')}</span>
      <button type="button" class="cardart__reset" data-testid="card-art-reset" onClick=${onReset}>${t('重置')}</button>
    </header>
    <div class="cardart__row">
      <span class="cardart__k">${t('干员')}</span>
      <b class="cardart__opname">${operator || charId || ''}</b>
      ${onPickOperator ? html`<button type="button" class="cardart__pick" data-testid="card-art-pick" onClick=${onPickOperator}>${t('更换立绘')}</button>` : null}
    </div>
    <div class="cardart__row">
      <span class="cardart__k">${t('立绘')}</span>
      <div class="cardart__ver" role="group" aria-label=${t('立绘')}>
        ${options.map(([key, label]) => html`<button type="button" key=${key}
            class=${'cardart__vbtn' + (activeKey === key ? ' is-on' : '')} data-art=${key.startsWith('skin:') ? 'skin' : key}
            data-skin=${key.startsWith('skin:') ? key.slice(5) : null}
            aria-pressed=${activeKey === key ? 'true' : 'false'} onClick=${() => onVersion(key)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardart__row">
      <div class="cardart__fit">
        ${[['full', t('完整')], ['fill', t('填满')]].map(([id, label]) => html`<button type="button" key=${id}
            class=${'cardart__vbtn' + (v.fit === id ? ' is-on' : '')} data-fit=${id}
            aria-pressed=${v.fit === id ? 'true' : 'false'} onClick=${() => onFit(id)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardart__frame" ref=${frameRef} data-testid="card-art-frame" tabindex="0"
        role="application" aria-label=${t('拖拽调整位置')} style="touch-action: none">
      ${plan.src
        ? html`<${ArtPicture} src=${plan.src} value=${v} frameRef=${frameRef} dataArt=${plan.art} onError=${onBroken} />`
        : html`<span class="cardart__glyph">${[...(charId || '?')][0]}</span>`}
      <span class="cardart__hint">${t('拖拽调整位置')}</span>
    </div>
    <div class="cardart__zoom">
      <span class="cardart__zlabel">${t('缩放')}</span>
      <input type="range" class="cardart__range" data-testid="card-art-zoom" min=${ZOOM_MIN} max=${ZOOM_MAX} step="0.1"
        value=${v.zoom} aria-label=${t('缩放')}
        onInput=${(e) => onZoom(Number(e.currentTarget.value))} />
      <b class="cardart__znum num">${v.zoom.toFixed(1)}×</b>
    </div>
    <p class="cardart__pos">${t('位置')} <b class="num">${v.ox}</b> / <b class="num">${v.oy}</b></p>
  </section>`;
}

/**
 * 带交互的立绘调整：框内拖拽平移、触屏双指缩放、桌面滚轮缩放、键盘 ←/→ 调缩放。
 * 两处输入的数学都在这里（纯数值），normalizeCardArt 负责夹紧 —— 测试直接调 panTo / pinchTo。
 */
export function panTo(from, dx, dy, box) {
  const w = Math.max(1, Number(box?.w) || 1);
  const h = Math.max(1, Number(box?.h) || 1);
  const base = normalizeCardArt(from);
  return normalizeCardArt({ ...base, ox: base.ox + (dx / w) * 100, oy: base.oy + (dy / h) * 100 });
}

/** 双指缩放：d0 → d1 的比例乘在起始缩放上（夹在 0.8–2.0）。 */
export function pinchTo(from, d0, d1) {
  const base = normalizeCardArt(from);
  const ratio = d0 > 0 ? d1 / d0 : 1;
  return normalizeCardArt({ ...base, zoom: base.zoom * ratio });
}

/**
 * @param {{ charId: string, sources?: ArtSources|null, operator?: string|null, onPickOperator?: (() => void)|null }} props
 */
export function CardArt({ charId, sources = null, operator = null, onPickOperator = null }) {
  const [value, setValue] = useState(() => cardArtOf(charId));
  const frameRef = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  const gesture = useRef(null);
  const apply = (patch) => setValue((prev) => { const next = normalizeCardArt({ ...prev, ...patch }); setCardArt(charId, next); return next; });

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof el.addEventListener !== 'function') return undefined;
    const pts = new Map();
    const boxOf = () => {
      const r = el.getBoundingClientRect?.();
      return { w: Math.max(1, r?.width || 300), h: Math.max(1, r?.height || 400) };
    };
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const onDown = (e) => {
      pts.set(e.pointerId ?? 0, { x: e.clientX ?? 0, y: e.clientY ?? 0 });
      if (pts.size === 1) {
        gesture.current = { mode: 'pan', x: e.clientX ?? 0, y: e.clientY ?? 0, box: boxOf(), from: latest.current };
      } else if (pts.size === 2) {
        gesture.current = { mode: 'pinch', d0: spread(), from: latest.current };
      }
      try { el.setPointerCapture?.(e.pointerId); } catch { /* 合成事件 / 指针已抬起：捕获不到也不影响拖动 */ }
    };
    const onMove = (e) => {
      const id = e.pointerId ?? 0;
      if (!pts.has(id) || !gesture.current) return;
      pts.set(id, { x: e.clientX ?? 0, y: e.clientY ?? 0 });
      if (gesture.current.mode === 'pan' && pts.size === 1) {
        const g = gesture.current;
        const next = panTo(g.from, (e.clientX ?? 0) - g.x, (e.clientY ?? 0) - g.y, g.box);
        setValue(next);
        setCardArt(charId, next);
      } else if (gesture.current.mode === 'pinch' && pts.size === 2) {
        const next = pinchTo(gesture.current.from, gesture.current.d0, spread());
        setValue(next);
        setCardArt(charId, next);
      }
      if (typeof e.preventDefault === 'function') e.preventDefault();
    };
    const onUp = (e) => {
      const id = e.pointerId ?? 0;
      pts.delete(id);
      if (pts.size === 0) gesture.current = null;
      else if (pts.size === 1) {
        const [only] = [...pts.entries()];
        gesture.current = { mode: 'pan', x: only[1].x, y: only[1].y, box: boxOf(), from: latest.current };
      }
    };
    const onWheel = (e) => {
      // 只在框内拦滚轮（passive:false 才拦得住页面滚动），滚轮一格 ±0.1×
      if (typeof e.preventDefault === 'function') e.preventDefault();
      apply({ zoom: latest.current.zoom - Math.sign(e.deltaY) * 0.1 });
    };
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      apply({ zoom: latest.current.zoom + (e.key === 'ArrowRight' ? 0.1 : -0.1) });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, [charId]);

  // 面板给的 key：'e1' / 'e2' / 'skin:<skinId>'
  const pickArt = (key) => {
    if (key === 'e1' || key === 'e2') { apply({ art: key, skin: null }); return; }
    if (typeof key === 'string' && key.startsWith('skin:')) apply({ art: 'skin', skin: key.slice(5) });
  };
  return html`<${CardArtView} charId=${charId} sources=${sources} operator=${operator}
    onPickOperator=${onPickOperator} value=${value} frameRef=${frameRef}
    onVersion=${pickArt}
    onFit=${(m) => apply({ fit: m })}
    onZoom=${(z) => apply({ zoom: z })}
    onBroken=${() => { if (latest.current.art === 'e1') apply({ art: 'e2' }); }}
    onReset=${() => { setValue(resetCardArt(charId) || CARD_ART_DEFAULT); }} />`;
}

/**
 * 名片上的立绘（房间座位卡 / 大厅名字条共用）：按存下来的设置画，完整显示 + 虚化铺满。
 * 依次尝试 artPlan 给出的地址（精一缺 → 精二 → 皮肤），全部打不开才回调 onError，交给调用方退回头像框。
 * @param {{ charId: string, sources?: ArtSources|null, class?: string, onError?: (() => void)|null }} props
 */
export function CardArtImage({ charId, sources = null, class: cls = '', onError = null }) {
  ensureCardArtCss();
  const [failed, setFailed] = useState([]);
  const v = cardArtOf(charId);
  const plan = artPlan(sources, v.art, v.skin);
  const src = plan.chain.find((u) => !failed.includes(u)) || null;
  const wrapRef = useRef(null);
  if (!src) return null;
  const broken = () => {
    const rest = plan.chain.filter((u) => u !== src && !failed.includes(u));
    setFailed((f) => (f.includes(src) ? f : [...f, src]));
    if (!rest.length && typeof onError === 'function') onError();
  };
  return html`<span class="cardart__stillwrap" ref=${wrapRef}>
    <${ArtPicture} src=${src} value=${v} frameRef=${wrapRef} className=${cls} dataArt=${plan.art} onError=${broken} />
  </span>`;
}
