// PRTS battlefield artwork. IDs are explicit: the second-season m01/m02 are #05/#06,
// not the first-season m05/m06. Unknown stages keep their name without a wrong thumbnail.
import { useState } from '/vendor/hooks.module.js';
import { html, Button, Icon, Modal } from '/js/ui/components.js';
import { t } from '/shared/i18n.js';

const MAPS = Object.freeze({
  act1autochess_m01: '01', act1autochess_m02: '02', act1autochess_m03: '03', act1autochess_m04: '04',
  act2autochess_m01: '05', act2autochess_m02: '06',
  act1autochess_m05: 'legacy-upper-05', act1autochess_m06: 'legacy-upper-06', act1autochess_m07: 'legacy-upper-07',
  act2autochess_m03: 'legacy-lower-07', act2autochess_m04: 'legacy-lower-08',
});
export function stagePreviewUrl(stageId, field = 1) {
  const map = MAPS[stageId];
  return map ? `/ui-art/img/official/hub/ac/maps/${map.startsWith('legacy-') ? map : `map-${map}-${field}`}.png` : null;
}

export function StagePreview({ stageId, name, pool = '', onOpen }) {
  const src = stagePreviewUrl(stageId);
  const title = name || stageId || t('战场');
  return html`<section class="brief-map">
    <button class="brief-map__preview" disabled=${!src} onClick=${onOpen} aria-label=${t('查看战场') + ' · ' + title}>
      ${src ? html`<img src=${src} alt=${title} /><span class="brief-map__zoom"><${Icon} name="search" /></span>`
        : html`<span class="brief-map__empty">${title}<small>${t('暂无预览')}</small></span>`}
    </button>
    <div class="brief-map__caption"><b>${title}</b><span>${pool}</span></div>
  </section>`;
}

// Render alongside the briefing's footer and header, outside its scrolling columns.
export function StagePreviewDialog({ stageId, name, onClose }) {
  const [field, setField] = useState(1);
  const src = stagePreviewUrl(stageId, field);
  const fields = MAPS[stageId]?.startsWith('legacy-') ? [1] : [1, 2, 3];
  const title = name || stageId || t('战场');
  return html`<${Modal} open=${true} onClose=${onClose} title=${title} class="brief-map-dialog"
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('关闭')}<//>`}>
      <div class="brief-map__tabs" role="tablist" aria-label=${t('战场')}>
        ${fields.map(n => html`<button key=${n} role="tab" aria-selected=${field === n} onClick=${() => setField(n)}>${t('场地')}${n}</button>`)}
      </div>
      ${src ? html`<img class="brief-map__full" src=${src} alt=${title + ' · ' + t('场地') + field} />` : null}
    <//>`;
}
