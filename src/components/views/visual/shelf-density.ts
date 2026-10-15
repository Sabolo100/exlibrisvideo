/**
 * The reader's bookshelf density ("compact" | "comfortable") is kept in localStorage under this key (as JSON).
 * Only the browser knows it, so the server-rendered page cannot size the placeholder bookcase by it – that is what the
 * inline boot script (src/lib/boot-script.ts) is for: before the first paint it copies a "compact" choice onto
 * `<html data-shelf-density="compact">`, and the ghost bookcases (see ShelfGhost.tsx) pick their size from there.
 * Pure constants: the layout (server), the boot script and the shelf view (client) all import them.
 */
export const SHELF_DENSITY_KEY = 'exl.visual.shelf.density';

/** `dataset` name of that attribute on <html> (it renders as `data-shelf-density`) */
export const SHELF_DENSITY_DATASET = 'shelfDensity';
