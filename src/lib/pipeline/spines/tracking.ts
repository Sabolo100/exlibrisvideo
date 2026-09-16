/**
 * From per-frame boundaries to physical spines (pure).
 *
 * 1. Shelf chains: a band continues the band of the previous frame that it overlaps most (after the
 *    vertical camera shift); an unreliable motion step starts new chains.
 * 2. Every chain has its own reference x axis: x_ref = a_k·x + b_k, composed from the per-step
 *    transforms. Boundaries are compared at one physical row, so tilted spines line up too.
 * 3. Boundary tracks: each boundary joins the nearest track seen in the last few frames. A track counts
 *    when it was detected in enough of the frames that show its position (printed lines on a spine, glare
 *    or a hand come and go; the gap between two books stays).
 * 4. Spines: neighbouring accepted tracks. A view of a spine is a frame in which both of its boundary
 *    tracks were detected, so the cut uses that frame's own lines (no drift, no scale error).
 */
import type { Boundary } from './boundaries';
import { median } from './raster';

export interface FrameGeometry {
  width: number;
  height: number;
  /** full-resolution bands; boundary xc is measured at the band's centre row */
  bands: { y0: number; y1: number; boundaries: Boundary[] }[];
}

export interface FrameMotion {
  /** x_k = s·x_{k-1} + d (full resolution) */
  s: number;
  d: number;
  /** y_k = y_{k-1} + dy */
  dy: number;
  /** tracks and shelf chains do not continue across an unreliable step */
  reliable: boolean;
}

export interface SpineLine {
  /** x at the band's centre row, full resolution */
  xc: number;
  deg: number;
}

export interface SpineView {
  /** index into the frame list */
  frame: number;
  band: { y0: number; y1: number };
  left: SpineLine;
  right: SpineLine;
  /** 1 at the horizontal centre of the frame, 0 at its edge */
  centrality: number;
}

export interface SpineCandidate {
  /** shelf chain the spine was tracked on */
  chain: number;
  /** left→right index among the spines of the chain */
  position: number;
  views: SpineView[];
}

export interface TrackingOptions {
  /** share of the frames showing a boundary's position in which it must be detected */
  minSupport?: number;
  /** a boundary detected only once needs at least this score */
  singleScore?: number;
  /** frames a boundary may be missed before its track ends */
  maxGap?: number;
  /** spine views keep this share of the frame width away from both edges */
  edgeMargin?: number;
  /** narrowest spine as a share of the band height (never below 8 px) */
  minWidthFraction?: number;
  /** a band continues a band of the previous frame that it overlaps by this share of the lower one */
  minBandOverlap?: number;
}

interface ChainFrame {
  frame: number;
  band: { y0: number; y1: number; boundaries: Boundary[] };
  a: number;
  b: number;
  oy: number;
}

interface Track {
  X: number;
  last: number;
  obs: Map<number, Boundary>;
}

export function buildSpineCandidates(
  frames: readonly FrameGeometry[],
  motions: readonly (FrameMotion | null)[],
  opts: TrackingOptions = {},
): SpineCandidate[] {
  const minSupport = opts.minSupport ?? 0.45;
  const singleScore = opts.singleScore ?? 1.3;
  const maxGap = opts.maxGap ?? 3;
  const edgeMargin = opts.edgeMargin ?? 0.015;
  const minWidthFraction = opts.minWidthFraction ?? 0.02;
  const minBandOverlap = opts.minBandOverlap ?? 0.4;

  /* ---- 1. shelf chains ---- */
  const chains: ChainFrame[][] = [];
  let previous: { chain: number; y0: number; y1: number }[] = [];
  frames.forEach((frame, k) => {
    const motion = k > 0 ? motions[k] : null;
    const continues = !!motion && motion.reliable;
    const claims = frame.bands.map((band, bi) => {
      let best: { chain: number; ratio: number } | null = null;
      if (continues) {
        for (const p of previous) {
          const y0 = p.y0 + motion!.dy;
          const y1 = p.y1 + motion!.dy;
          const overlap = Math.min(y1, band.y1) - Math.max(y0, band.y0);
          const ratio = overlap / Math.max(1, Math.min(y1 - y0, band.y1 - band.y0));
          if (ratio >= minBandOverlap && (!best || ratio > best.ratio)) best = { chain: p.chain, ratio };
        }
      }
      return { bi, best };
    });
    // one band per chain per frame: the best-overlapping band continues it, the others start new chains
    claims.sort((x, y) => (y.best?.ratio ?? 0) - (x.best?.ratio ?? 0));
    const taken = new Set<number>();
    const current: { chain: number; y0: number; y1: number }[] = [];
    for (const { bi, best } of claims) {
      const band = frame.bands[bi];
      let chain: number;
      if (best && !taken.has(best.chain)) {
        chain = best.chain;
        const prev = chains[chain][chains[chain].length - 1];
        const m = motion!;
        const a = prev.a / m.s;
        chains[chain].push({ frame: k, band, a, b: prev.b - (prev.a * m.d) / m.s, oy: prev.oy + m.dy });
      } else {
        chain = chains.length;
        chains.push([{ frame: k, band, a: 1, b: 0, oy: 0 }]);
      }
      taken.add(chain);
      current.push({ chain, y0: band.y0, y1: band.y1 });
    }
    previous = current;
  });

  /* ---- 2–4. tracks and spines per chain ---- */
  const out: SpineCandidate[] = [];
  chains.forEach((chain, chainIndex) => {
    const refRow = median(chain.map((c) => (c.band.y0 + c.band.y1) / 2 - c.oy));
    const tracks: Track[] = [];
    for (const c of chain) {
      const bandHeight = c.band.y1 - c.band.y0;
      const yc = (c.band.y0 + c.band.y1) / 2;
      const rowHere = refRow + c.oy;
      const points = c.band.boundaries.map((bd) => {
        const x = bd.xc + Math.tan((bd.deg * Math.PI) / 180) * (rowHere - yc);
        return { X: c.a * x + c.b, bd };
      });
      const tolerance = Math.max(8, 0.03 * bandHeight) * c.a;
      const pairs: { p: (typeof points)[number]; t: Track; dist: number }[] = [];
      for (const p of points) {
        for (const t of tracks) {
          if (t.last === c.frame || c.frame - t.last > maxGap) continue;
          const dist = Math.abs(t.X - p.X);
          if (dist <= tolerance) pairs.push({ p, t, dist });
        }
      }
      pairs.sort((x, y) => x.dist - y.dist);
      const usedPoints = new Set<(typeof points)[number]>();
      const usedTracks = new Set<Track>();
      for (const { p, t } of pairs) {
        if (usedPoints.has(p) || usedTracks.has(t)) continue;
        usedPoints.add(p);
        usedTracks.add(t);
        t.X = (t.X + p.X) / 2;
        t.last = c.frame;
        t.obs.set(c.frame, p.bd);
      }
      for (const p of points) {
        if (!usedPoints.has(p)) tracks.push({ X: p.X, last: c.frame, obs: new Map([[c.frame, p.bd]]) });
      }
    }

    const accepted = tracks
      .filter((t) => {
        let visible = 0;
        for (const c of chain) {
          const x = (t.X - c.b) / c.a;
          const w = frames[c.frame].width;
          if (x > 0.03 * w && x < 0.97 * w) visible++;
        }
        const support = t.obs.size / Math.max(1, visible);
        const score = median([...t.obs.values()].map((o) => o.score));
        return support >= minSupport && (t.obs.size >= 2 || score >= singleScore || chain.length === 1);
      })
      .sort((x, y) => x.X - y.X);

    let position = 0;
    for (let i = 0; i + 1 < accepted.length; i++) {
      const L = accepted[i];
      const R = accepted[i + 1];
      const views: SpineView[] = [];
      for (const c of chain) {
        const left = L.obs.get(c.frame);
        const right = R.obs.get(c.frame);
        if (!left || !right) continue;
        const width = frames[c.frame].width;
        const bandHeight = c.band.y1 - c.band.y0;
        if (right.xc - left.xc < Math.max(8, minWidthFraction * bandHeight)) continue;
        if (left.xc < edgeMargin * width || right.xc > (1 - edgeMargin) * width) continue;
        views.push({
          frame: c.frame,
          band: { y0: c.band.y0, y1: c.band.y1 },
          left: { xc: left.xc, deg: left.deg },
          right: { xc: right.xc, deg: right.deg },
          centrality: Math.max(0, 1 - Math.abs((left.xc + right.xc) / 2 - width / 2) / (width / 2)),
        });
      }
      if (views.length) out.push({ chain: chainIndex, position: position++, views });
    }
  });
  return out;
}
