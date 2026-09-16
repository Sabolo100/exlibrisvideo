/**
 * Minimal rich-text typesetter on top of pdfkit: mixed styles and font subsets on one
 * line, greedy word wrapping, hard breaks for over-long words, max-lines with ellipsis,
 * baseline-aligned drawing. pdfkit's own wrapper cannot wrap text whose words span
 * several fonts, so layout is done here and every run is drawn at an explicit position.
 */
import type { FontStyle, PdfFonts } from './pdf-fonts';

export interface Span {
  text: string;
  style: FontStyle;
  size: number;
  color: string;
  /** optional URI annotation over the span */
  link?: string;
}

export interface Piece {
  text: string;
  font: string;
  size: number;
  color: string;
  width: number;
  link?: string;
}

export interface Line {
  pieces: Piece[];
  width: number;
  /** largest font size on the line */
  size: number;
}

export interface LayoutOptions {
  /** 0 or undefined = unlimited */
  maxLines?: number;
}

interface Word {
  pieces: Piece[];
  width: number;
  /** whitespace following the word (measured in the style of the span it came from) */
  space: Piece | null;
}

const ELLIPSIS = '…';

export class Typesetter {
  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly fonts: PdfFonts,
  ) {}

  measure(font: string, size: number, text: string): number {
    if (!text) return 0;
    this.doc.font(font).fontSize(size);
    return this.doc.widthOfString(text);
  }

  /** Width of a span list laid out on a single line. */
  widthOf(spans: Span[]): number {
    let w = 0;
    for (const s of spans) for (const r of this.fonts.runs(s.text, s.style)) w += this.measure(r.font, s.size, r.text);
    return w;
  }

  private piece(text: string, font: string, span: Span): Piece {
    return { text, font, size: span.size, color: span.color, width: this.measure(font, span.size, text), link: span.link };
  }

  private words(spans: Span[]): Word[] {
    const words: Word[] = [];
    let current: Word = { pieces: [], width: 0, space: null };
    const pushCurrent = () => {
      if (current.pieces.length) words.push(current);
      current = { pieces: [], width: 0, space: null };
    };
    for (const span of spans) {
      if (!span.text) continue;
      for (const run of this.fonts.runs(span.text, span.style)) {
        const parts = run.text.split(/( +)/);
        for (const part of parts) {
          if (!part) continue;
          if (part.startsWith(' ')) {
            if (current.pieces.length) {
              current.space = this.piece(' ', run.font, span);
              pushCurrent();
            } else if (words.length && !words[words.length - 1].space) {
              words[words.length - 1].space = this.piece(' ', run.font, span);
            }
            continue;
          }
          const p = this.piece(part, run.font, span);
          current.pieces.push(p);
          current.width += p.width;
        }
      }
    }
    pushCurrent();
    return words;
  }

  /** Splits a word that is wider than the line into chunks that fit. */
  private hardBreak(word: Word, maxWidth: number): Word[] {
    const chunks: Word[] = [];
    let cur: Word = { pieces: [], width: 0, space: null };
    for (const p of word.pieces) {
      let remaining = p.text;
      while (remaining) {
        const avail = maxWidth - cur.width;
        const fit = this.fitChars(p.font, p.size, remaining, avail);
        if (fit === 0) {
          if (cur.pieces.length === 0) {
            // not even one character fits on an empty line – place one anyway
            const first = Array.from(remaining)[0];
            const piece = { ...p, text: first, width: this.measure(p.font, p.size, first) };
            cur.pieces.push(piece);
            cur.width += piece.width;
            remaining = remaining.slice(first.length);
          }
          chunks.push(cur);
          cur = { pieces: [], width: 0, space: null };
          continue;
        }
        const chars = Array.from(remaining);
        const head = chars.slice(0, fit).join('');
        const piece = { ...p, text: head, width: this.measure(p.font, p.size, head) };
        cur.pieces.push(piece);
        cur.width += piece.width;
        remaining = chars.slice(fit).join('');
        if (remaining) {
          chunks.push(cur);
          cur = { pieces: [], width: 0, space: null };
        }
      }
    }
    if (cur.pieces.length) chunks.push(cur);
    if (chunks.length) chunks[chunks.length - 1].space = word.space;
    return chunks;
  }

  /** Largest number of leading characters of `text` that fit in `avail` (binary search). */
  private fitChars(font: string, size: number, text: string, avail: number): number {
    const chars = Array.from(text);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(font, size, chars.slice(0, mid).join('')) <= avail + 0.01) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  layout(spans: Span[], maxWidth: number, opts: LayoutOptions = {}): Line[] {
    const lines: Line[] = [];
    let line: Line = { pieces: [], width: 0, size: 0 };
    let pendingSpace: Piece | null = null;
    const newLine = () => {
      if (line.pieces.length) lines.push(line);
      line = { pieces: [], width: 0, size: 0 };
      pendingSpace = null;
    };
    const append = (w: Word) => {
      if (line.pieces.length && pendingSpace) {
        line.pieces.push(pendingSpace);
        line.width += pendingSpace.width;
      }
      for (const p of w.pieces) {
        line.pieces.push(p);
        line.width += p.width;
        line.size = Math.max(line.size, p.size);
      }
      pendingSpace = w.space;
    };

    for (const word of this.words(spans)) {
      const spaceW = line.pieces.length && pendingSpace ? (pendingSpace as Piece).width : 0;
      if (line.pieces.length && line.width + spaceW + word.width > maxWidth + 0.01) newLine();
      if (!line.pieces.length && word.width > maxWidth + 0.01) {
        const chunks = this.hardBreak(word, maxWidth);
        chunks.forEach((chunk, i) => {
          append(chunk);
          if (i < chunks.length - 1) newLine();
        });
        continue;
      }
      append(word);
    }
    newLine();

    const merged = lines.map((l) => this.finish(l.pieces, l.size));
    if (opts.maxLines && merged.length > opts.maxLines) {
      const kept = merged.slice(0, opts.maxLines);
      kept[kept.length - 1] = this.ellipsize(kept[kept.length - 1], maxWidth, true);
      return kept;
    }
    return merged;
  }

  /** Single line, truncated with an ellipsis when wider than maxWidth. */
  singleLine(spans: Span[], maxWidth: number): Line {
    const words = this.words(spans);
    const pieces: Piece[] = [];
    words.forEach((w, i) => {
      pieces.push(...w.pieces);
      if (w.space && i < words.length - 1) pieces.push(w.space);
    });
    const line = this.finish(
      pieces,
      pieces.reduce((s, p) => Math.max(s, p.size), 0),
    );
    return line.width > maxWidth + 0.01 ? this.ellipsize(line, maxWidth, false) : line;
  }

  /** Trims a line so that it plus "…" fits; `force` adds the ellipsis even when it already fits. */
  private ellipsize(line: Line, maxWidth: number, force: boolean): Line {
    if (!force && line.width <= maxWidth + 0.01) return line;
    const pieces = line.pieces.map((p) => ({ ...p }));
    // drop trailing spaces
    while (pieces.length && !pieces[pieces.length - 1].text.trim()) pieces.pop();
    const last = pieces[pieces.length - 1];
    if (!last) return line;
    const ellFont = last.font;
    const ellW = this.measure(ellFont, last.size, ELLIPSIS);
    let total = pieces.reduce((s, p) => s + p.width, 0);
    while (pieces.length && total + ellW > maxWidth + 0.01) {
      const p = pieces[pieces.length - 1];
      const avail = maxWidth - ellW - (total - p.width);
      const fit = avail > 0 ? this.fitChars(p.font, p.size, p.text, avail) : 0;
      if (fit <= 0) {
        pieces.pop();
        total -= p.width;
        continue;
      }
      const text = Array.from(p.text).slice(0, fit).join('').replace(/\s+$/, '');
      const w = this.measure(p.font, p.size, text);
      total = total - p.width + w;
      p.text = text;
      p.width = w;
      break;
    }
    const tail = pieces[pieces.length - 1] ?? last;
    pieces.push({ text: ELLIPSIS, font: ellFont, size: tail.size, color: tail.color, width: ellW, link: tail.link });
    total += ellW;
    return this.finish(
      pieces.filter((p) => p.text),
      line.size,
    );
  }

  /**
   * Draws a line with its baseline at `baseline`. `align` positions it inside [x, x + width].
   * Returns the x after the last piece.
   */
  drawLine(line: Line, x: number, baseline: number, align: 'left' | 'center' | 'right' = 'left', width = 0): number {
    let cx = x;
    if (align === 'center') cx = x + (width - line.width) / 2;
    else if (align === 'right') cx = x + width - line.width;
    for (const p of line.pieces) {
      if (p.text) {
        this.doc.font(p.font).fontSize(p.size).fillColor(p.color);
        this.doc.text(p.text, cx, baseline, { lineBreak: false, baseline: 'alphabetic' });
        if (p.link) this.doc.link(cx, baseline - p.size * 0.8, p.width, p.size * 1.05, p.link);
      }
      cx += p.width;
    }
    return cx;
  }

  /**
   * Draws lines starting at `top`, each `lineHeight × size` tall. Returns the y below the block.
   */
  drawLines(
    lines: Line[],
    x: number,
    top: number,
    opts: { lineHeight?: number; align?: 'left' | 'center' | 'right'; width?: number } = {},
  ): number {
    const factor = opts.lineHeight ?? 1.3;
    let y = top;
    for (const line of lines) {
      const h = line.size * factor;
      const baseline = y + (h - line.size) / 2 + line.size * 0.8;
      this.drawLine(line, x, baseline, opts.align ?? 'left', opts.width ?? 0);
      y += h;
    }
    return y;
  }

  static heightOf(lines: Line[], lineHeight = 1.3): number {
    return lines.reduce((s, l) => s + l.size * lineHeight, 0);
  }

  /** Joins adjacent pieces with identical formatting and re-measures them (kerning across the joint). */
  private mergePieces(pieces: Piece[]): Piece[] {
    const out: Piece[] = [];
    for (const p of pieces) {
      const prev = out[out.length - 1];
      if (prev && prev.font === p.font && prev.size === p.size && prev.color === p.color && prev.link === p.link) {
        prev.text += p.text;
      } else {
        out.push({ ...p });
      }
    }
    for (const p of out) p.width = this.measure(p.font, p.size, p.text);
    return out;
  }

  private finish(pieces: Piece[], size: number): Line {
    const merged = this.mergePieces(pieces);
    return { pieces: merged, width: merged.reduce((s, p) => s + p.width, 0), size };
  }
}
