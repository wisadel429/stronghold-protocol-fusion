/** Closure HUD chrome v5 — decorative only; never wrap countdown (flex-safe). */
const THEME = 'ac_s_closur';
function isClosure() {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-ac-terminal-theme') === THEME;
}
/** Unwrap any stale CRT wrap from older builds so .gtop__right flex is restored. */
function unwrapCrt() {
  document.querySelectorAll('.ac-closure-crt').forEach((w) => {
    const cd = w.querySelector('.countdown');
    if (cd && w.parentElement) w.parentElement.insertBefore(cd, w);
    w.remove();
  });
}
function ensureBat() {
  const bonds = document.querySelector('.gm__bonds');
  if (!bonds || !isClosure()) return;
  if (bonds.querySelector(':scope > .ac-closure-bat')) return;
  const bat = document.createElement('div');
  bat.className = 'ac-closure-bat';
  bat.setAttribute('aria-hidden', 'true');
  bat.innerHTML = '<i class="ac-closure-bat__glow"></i><i class="ac-closure-bat__icon"></i>';
  bonds.appendChild(bat);
}
function ensureBanner(forceText) {
  if (!isClosure()) return;
  const params = new URLSearchParams(location.search);
  const elExisting = document.querySelector('.ac-closure-banner');
  // Default OFF for prep/shop. Only show with ?banner= / ?phaseBanner= (not banner=0).
  const raw = forceText || params.get('banner') || params.get('phaseBanner');
  if (!raw || raw === '0' || params.get('nobanner') === '1') {
    if (elExisting) {
      elExisting.classList.remove('is-show');
      elExisting.classList.add('is-hide');
    }
    return;
  }
  const hud = document.querySelector('.gm__hud') || document.querySelector('.gm') || document.body;
  let el = elExisting;
  if (!el) {
    el = document.createElement('div');
    el.className = 'ac-closure-banner';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i class="ac-closure-banner__tv"></i><i class="ac-closure-banner__bat"></i><span class="ac-closure-banner__txt"></span><span class="ac-closure-banner__chev">&gt;&gt;&gt;</span>';
    hud.appendChild(el);
  }
  const txt = el.querySelector('.ac-closure-banner__txt');
  if (txt) txt.textContent = raw === '1' ? '联防阶段' : raw;
  el.classList.remove('is-hide');
  el.classList.add('is-show');
  // auto-hide after ~1.5s so it never sticks over shop/mid-HUD
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('is-show');
    el.classList.add('is-hide');
  }, 1500);
}
let scheduled = false;
export function tick() {
  unwrapCrt();
  if (!isClosure()) {
    document.querySelectorAll('.ac-closure-bat, .ac-closure-banner').forEach((n) => n.remove());
    return;
  }
  ensureBat();
  ensureBanner();
}
function scheduleTick() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; tick(); });
}
export function installClosureChrome() {
  if (typeof document === 'undefined') return;
  if (window.__AC_CLOSURE_CHROME__) return;
  window.__AC_CLOSURE_CHROME__ = { tick, ensureBat, ensureBanner, unwrapCrt };
  const boot = () => {
    tick();
    const mo = new MutationObserver(scheduleTick);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ac-terminal-theme'] });
    const mount = document.querySelector('#app') || document.body;
    mo.observe(mount, { childList: true, subtree: true });
    setInterval(tick, 2000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
installClosureChrome();
