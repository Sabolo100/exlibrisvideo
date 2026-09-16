/**
 * Geometry of one video: shelf bands and spine boundaries per frame, camera motion between consecutive
 * frames, and the resulting spine candidates.
 */
import { type Band, DEFAULT_EDGE_THRESHOLD, detectBands } from './bands';
import { type Boundary, detectBoundaries } from './boundaries';
import { estimateShift, loadProfiles, refineWithBoundaries, type Profile } from './motion';
import { loadGray, sobel } from './raster';
import { buildSpineCandidates, type FrameGeometry, type FrameMotion, type SpineCandidate } from './tracking';

/** frames are analysed with their short side scaled to this many px */
export const WORKING_SHORT_SIDE = 540;
/** a column profile match counts as reliable from this correlation … */
const MIN_SHIFT_SCORE = 0.75;
/** … when no other shift correlates almost as well */
const MIN_SHIFT_MARGIN = 0.05;

/** a band cut off by the top or bottom of the frame is kept only when it is at least this tall (close-ups) */
const MIN_CUT_BAND_FRACTION = 0.45;

/**
 * Drops the slivers of neighbouring shelves at the top or bottom of the frame: their books are cut off and
 * are either seen completely in other frames or were not meant to be filmed.
 */
export function keepBand(band: Pick<Band, 'y0' | 'y1'>, height: number): boolean {
  const cut = band.y0 <= height * 0.01 || band.y1 >= height * 0.99;
  return !cut || band.y1 - band.y0 >= height * MIN_CUT_BAND_FRACTION;
}

export interface AnalyzedFrame {
  geometry: FrameGeometry;
  profiles: { columns: Profile; rows: Profile };
  /** boundaries of the tallest band (motion refinement) */
  mainBoundaries: number[];
}

export async function analyzeFrame(input: string | Buffer): Promise<AnalyzedFrame> {
  const probe = await loadGray(input, 1 / 16);
  const scale = Math.min(1, WORKING_SHORT_SIDE / Math.max(1, Math.min(probe.fullWidth, probe.fullHeight)));
  const { image, fullWidth, fullHeight } = await loadGray(input, scale);
  const grad = sobel(image);
  const toFull = fullWidth / image.width;
  const bands: Band[] = detectBands(image, grad, { edgeThreshold: DEFAULT_EDGE_THRESHOLD }).filter((band) => keepBand(band, image.height));
  const geometryBands = bands.map((band) => {
    const boundaries: Boundary[] = detectBoundaries(image, grad, band, { edgeThreshold: DEFAULT_EDGE_THRESHOLD }).map((b) => ({
      xc: b.xc * toFull,
      deg: b.deg,
      score: b.score,
    }));
    return { y0: band.y0 * toFull, y1: band.y1 * toFull, boundaries };
  });
  const main = [...geometryBands].sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0))[0];
  const profiles = await loadProfiles(input, main ? main.y0 : fullHeight * 0.3, main ? main.y1 : fullHeight * 0.7);
  return {
    geometry: { width: fullWidth, height: fullHeight, bands: geometryBands },
    profiles,
    mainBoundaries: main ? main.boundaries.map((b) => b.xc) : [],
  };
}

/** Motion from `prev` to `next`; unreliable when the shelf cannot be matched with confidence. */
export function frameMotion(prev: AnalyzedFrame, next: AnalyzedFrame): FrameMotion {
  const horizontal = estimateShift(prev.profiles.columns, next.profiles.columns);
  if (!horizontal) return { s: 1, d: 0, dy: 0, reliable: false };
  let reliable = horizontal.score >= MIN_SHIFT_SCORE && horizontal.margin >= MIN_SHIFT_MARGIN;
  const transform = refineWithBoundaries(prev.mainBoundaries, next.mainBoundaries, horizontal.shift, reliable ? 24 : 40);
  if (!reliable) {
    // a weak profile match still counts when most boundaries line up with it
    const needed = Math.max(4, 0.5 * Math.min(prev.mainBoundaries.length, next.mainBoundaries.length));
    reliable = transform.matches >= needed;
  }
  const vertical = estimateShift(prev.profiles.rows, next.profiles.rows, { minOverlap: 0.5 });
  const dy = vertical && vertical.score >= 0.6 ? vertical.shift : 0;
  return { s: transform.s, d: transform.d, dy, reliable };
}

export interface VideoGeometry {
  frames: FrameGeometry[];
  motions: (FrameMotion | null)[];
  candidates: SpineCandidate[];
}

/** Analyses the frames in order (one decoded frame in memory at a time) and tracks the spines. */
export async function analyzeVideoGeometry(
  inputs: readonly (string | Buffer)[],
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void | Promise<void> } = {},
): Promise<VideoGeometry> {
  const frames: FrameGeometry[] = [];
  const motions: (FrameMotion | null)[] = [];
  let previous: AnalyzedFrame | null = null;
  for (let i = 0; i < inputs.length; i++) {
    if (opts.signal?.aborted) throw Object.assign(new Error('spine geometry aborted'), { name: 'AbortError' });
    const analyzed = await analyzeFrame(inputs[i]);
    frames.push(analyzed.geometry);
    motions.push(previous ? frameMotion(previous, analyzed) : null);
    previous = analyzed;
    await opts.onProgress?.((i + 1) / inputs.length);
  }
  return { frames, motions, candidates: buildSpineCandidates(frames, motions) };
}
