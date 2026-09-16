/**
 * Pure helpers of the frames view: grouping key frames by source, detection lookup, fitting a
 * frame into the stage and scaling pixel bounding boxes to the rendered size. No DOM – unit-tested.
 */
import type { BBox, FrameDTO, VideoDTO } from '@/lib/types';

export interface FrameDetection {
  frameId: string;
  bookId: string | null;
  bbox: BBox | null;
}

export interface FrameGroup {
  videoId: string;
  /** null when the frame's source is not in collection.videos (removed meanwhile) */
  video: VideoDTO | null;
  /** idx order */
  frames: FrameDTO[];
}

/**
 * Frames grouped per source in `collection.videos` order (sortOrder, then creation), frames by
 * `idx`. Frames of sources that are no longer listed come last, in first-seen order.
 */
export function groupFramesByVideo(frames: readonly FrameDTO[], videos: readonly VideoDTO[]): FrameGroup[] {
  const byVideo = new Map<string, FrameDTO[]>();
  for (const frame of frames) {
    const list = byVideo.get(frame.videoId);
    if (list) list.push(frame);
    else byVideo.set(frame.videoId, [frame]);
  }
  const ordered = [...videos].sort(
    (a, b) => a.sortOrder - b.sortOrder || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const groups: FrameGroup[] = [];
  for (const video of ordered) {
    const list = byVideo.get(video.id);
    if (!list) continue;
    groups.push({ videoId: video.id, video, frames: [...list].sort((a, b) => a.idx - b.idx || a.timeSec - b.timeSec) });
    byVideo.delete(video.id);
  }
  for (const [videoId, list] of byVideo) {
    groups.push({ videoId, video: null, frames: [...list].sort((a, b) => a.idx - b.idx || a.timeSec - b.timeSec) });
  }
  return groups;
}

/** Detections per frame id (API order = left→right within the frame). */
export function indexDetections(detections: readonly FrameDetection[]): Map<string, FrameDetection[]> {
  const map = new Map<string, FrameDetection[]>();
  for (const d of detections) {
    const list = map.get(d.frameId);
    if (list) list.push(d);
    else map.set(d.frameId, [d]);
  }
  return map;
}

/** Largest size with the frame's aspect ratio that fits `maxWidth` × `maxHeight` (never upscaled beyond 2×). */
export function fitFrame(
  frameWidth: number,
  frameHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number; scale: number } {
  if (!(frameWidth > 0) || !(frameHeight > 0) || !(maxWidth > 0) || !(maxHeight > 0)) {
    return { width: 0, height: 0, scale: 0 };
  }
  const scale = Math.min(maxWidth / frameWidth, maxHeight / frameHeight, 2);
  return { width: Math.floor(frameWidth * scale), height: Math.floor(frameHeight * scale), scale };
}

export interface ScaledBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a bbox from frame pixel space (frame.width × frame.height) to a rendered size, normalising
 * swapped corners and clamping to the frame. null for missing / degenerate boxes.
 */
export function scaleBBox(
  bbox: BBox | null,
  frame: { width: number; height: number },
  rendered: { width: number; height: number },
): ScaledBox | null {
  if (!bbox || !(frame.width > 0) || !(frame.height > 0)) return null;
  const vals = [bbox.x0, bbox.y0, bbox.x1, bbox.y1];
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const clampX = (v: number) => Math.min(frame.width, Math.max(0, v));
  const clampY = (v: number) => Math.min(frame.height, Math.max(0, v));
  const x0 = clampX(Math.min(bbox.x0, bbox.x1));
  const x1 = clampX(Math.max(bbox.x0, bbox.x1));
  const y0 = clampY(Math.min(bbox.y0, bbox.y1));
  const y1 = clampY(Math.max(bbox.y0, bbox.y1));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const sx = rendered.width / frame.width;
  const sy = rendered.height / frame.height;
  // 1/100 px is invisible; it keeps float noise (57.599999999999994px) out of the inline styles
  const r = (v: number) => Math.round(v * 100) / 100;
  return { left: r(x0 * sx), top: r(y0 * sy), width: r((x1 - x0) * sx), height: r((y1 - y0) * sy) };
}

/** "0:07", "12:05", "1:02:03" for durations. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Time stamp of a frame with tenths: "0:04.5". */
export function formatTimestamp(seconds: number, decimalSeparator = '.'): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')}${decimalSeparator}${t}`;
}

/** Id of the frame `step` positions away in the flattened order (clamped; null for unknown ids). */
export function stepFrame(order: readonly string[], currentId: string | null, step: number): string | null {
  if (order.length === 0) return null;
  const i = currentId ? order.indexOf(currentId) : -1;
  if (i < 0) return order[0];
  return order[Math.min(order.length - 1, Math.max(0, i + step))];
}

/**
 * How to print the book title inside a box: along the spine (vertical, reading bottom-to-top like
 * the spine itself) for tall boxes, horizontally for lying books, or not at all when the box is
 * thinner than `minThickness` px.
 */
export function labelOrientation(box: ScaledBox, minThickness = 14): 'vertical' | 'horizontal' | 'none' {
  const tall = box.height >= box.width * 1.3;
  const thickness = tall ? box.width : box.height;
  if (thickness < minThickness) return 'none';
  if (!tall && box.width < 40) return 'none';
  return tall ? 'vertical' : 'horizontal';
}
