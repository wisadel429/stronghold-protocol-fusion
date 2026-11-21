// Closure's bond activation, driven by the BondStrip's server-provided active/tier flags.
// Footage 07-04-02, 392.267 s: the circle switches immediately, a short cyan column rises,
// and the new entry recentres the row in one video frame. sortBonds/flex remain authoritative.
import { useLayoutEffect, useRef, useState } from '/vendor/hooks.module.js';
import { html } from '/js/ui/components.js';

/** No burst on initial mount, changing the watched player, or ordinary layer/count updates. */
export function useClosureBondFx(bonds, { enabled, owner, layersDisabled }) {
  const previous = useRef(null);
  const serial = useRef(0);
  const [bursts, setBursts] = useState(() => new Map());
  const signature = JSON.stringify(bonds.map(b => [b.bondId, !!b.active, !!b.off, b.tier ?? 0]));
  useLayoutEffect(() => {
    if (!enabled) { previous.current = null; return; }
    const entries = new Map(bonds.map(b => [b.bondId, { active: !!b.active && !b.off, tier: b.tier ?? 0 }]));
    const was = previous.current;
    previous.current = { owner, entries };
    if (!was || was.owner !== owner || layersDisabled) {
      setBursts(old => old.size ? new Map() : old);
      return;
    }
    const activated = [];
    for (const [id, now] of entries) {
      const old = was.entries.get(id);
      if (now.active && (!old?.active || now.tier > old.tier)) activated.push(id);
    }
    setBursts(old => {
      const next = new Map([...old].filter(([id]) => entries.get(id)?.active));
      for (const id of activated) next.set(id, ++serial.current);
      return activated.length || next.size !== old.size ? next : old;
    });
  }, [signature, enabled, owner, layersDisabled]);
  return bursts;
}

// Recolour only the mint component of the existing 77x77 ring sprites. Greys remain grey.
export function ClosureBondPalette() {
  return html`<svg class="cbond__defs" width="0" height="0" aria-hidden="true" focusable="false">
    <filter id="closure-bond-blue" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="1.16 -.16 0 0 0  1.14 -.14 0 0 0  -.28 .28 1 0 0  0 0 0 1 0" />
    </filter>
    <filter id="closure-bond-active-ring" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 .235  0 0 0 0 .25  0 0 0 0 .88  0 0 0 1 0" />
    </filter>
    <filter id="closure-bond-glyph" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 .35  0 0 0 0 1  0 0 0 0 .96  0 0 0 1 0" />
    </filter>
  </svg>`;
}

export function ClosureBondMarks({ active, tier = 0, burst }) {
  if (!active) return null;
  return html`<span class="cbond__marks" aria-hidden="true">
    <span class="cbond__rank">${Array.from({ length: Math.max(1, Math.min(4, tier)) }, (_, i) => html`<i key=${i}></i>`)}</span>
    ${burst ? html`<span class="cbond__burst" key=${burst} data-activation=${burst}>
      <i class="cbond__beam"></i><i class="cbond__flash"></i>
    </span>` : null}
  </span>`;
}
