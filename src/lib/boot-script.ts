import { SHELF_DENSITY_DATASET, SHELF_DENSITY_KEY } from '@/components/views/visual/shelf-density';

/**
 * The inline script that runs in <head> before the first paint (app/layout.tsx). It puts what only this browser
 * knows – kept in localStorage – onto <html>, so the server-rendered page already looks the way this reader wants:
 *
 *  - `data-theme` "light" | "dark" from "exl_theme" (light | dark | system);
 *  - `data-shelf-density="compact"` from the shelf view's density choice, so the placeholder bookcase (and the loading
 *    skeleton of a catalogue) is as high as the real one will be instead of jumping from the comfortable size.
 *
 * Every read is guarded: blocked storage or a malformed value just leaves the defaults.
 */
export const BOOT_SCRIPT =
  `(function(){var h=document.documentElement;` +
  `try{var t=localStorage.getItem('exl_theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);h.dataset.theme=d?'dark':'light';}catch(e){}` +
  `try{if(JSON.parse(localStorage.getItem(${JSON.stringify(SHELF_DENSITY_KEY)}))==='compact')h.dataset.${SHELF_DENSITY_DATASET}='compact';}catch(e){}` +
  `})();`;
