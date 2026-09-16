/**
 * Small inline SVG diagrams for the filming tips (decorative, theme-aware through fill-/stroke- token utilities).
 * Server-safe: no hooks, no client code.
 */
import type { ReactNode } from 'react';

const SPINE_FILLS = ['fill-primary', 'fill-burgundy', 'fill-accent', 'fill-wood', 'fill-muted'] as const;

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 200 120" className="h-auto w-full" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** A row of front-facing spines standing on a plank. */
function SpineRow({ x, y, count, width = 14, gap = 2, heights = [52, 60, 46, 58, 64, 50, 56, 48, 62, 54] }: {
  x: number;
  y: number;
  count: number;
  width?: number;
  gap?: number;
  heights?: number[];
}) {
  const spines: ReactNode[] = [];
  let cx = x;
  for (let i = 0; i < count; i++) {
    const h = heights[i % heights.length];
    const w = width + ((i * 7) % 3) * 2;
    spines.push(
      <g key={i}>
        <rect x={cx} y={y - h} width={w} height={h} rx={1.5} className={SPINE_FILLS[i % SPINE_FILLS.length]} opacity={0.92} />
        <rect x={cx + w / 2 - 1} y={y - h + 10} width={2} height={h - 22} rx={1} className="fill-surface" opacity={0.45} />
      </g>,
    );
    cx += w + gap;
  }
  return (
    <g>
      {spines}
      <rect x={x - 6} y={y} width={cx - x + 10} height={6} rx={1.5} className="fill-wood" />
    </g>
  );
}

function Check({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={10} className="fill-success" />
      <path d={`M${x - 4.5} ${y}l3 3 6-6.5`} className="stroke-surface" strokeWidth={2.4} />
    </g>
  );
}

function Cross({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={10} className="fill-danger" />
      <path d={`M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8`} className="stroke-surface" strokeWidth={2.4} />
    </g>
  );
}

export function DistanceDiagram() {
  return (
    <Frame>
      <SpineRow x={14} y={92} count={4} heights={[48, 56, 42, 54]} />
      {/* viewing cone from the lens to the spines */}
      <path d="M152 52L90 34M152 60L90 90" className="stroke-accent" strokeWidth={1.5} strokeDasharray="4 4" />
      {/* phone seen from the side */}
      <rect x={152} y={26} width={26} height={58} rx={6} className="fill-surface stroke-ink" strokeWidth={2.5} />
      <circle cx={158} cy={56} r={2.5} className="fill-ink" />
      {/* dimension between the shelf front and the phone */}
      <path d="M92 108h58" className="stroke-ink" strokeWidth={1.5} />
      <path d="M96 104l-4 4 4 4M146 104l4 4-4 4" className="stroke-ink" strokeWidth={1.5} />
      <path d="M90 96v18M152 96v18" className="stroke-muted" strokeWidth={1} />
      <text x={121} y={103} textAnchor="middle" className="fill-ink" fontSize={11} fontWeight={700} fontFamily="Inter Variable, system-ui, sans-serif">
        20–40 cm
      </text>
    </Frame>
  );
}

export function PanDiagram() {
  return (
    <Frame>
      <SpineRow x={14} y={104} count={10} width={13} />
      {/* viewfinder */}
      <rect x={44} y={22} width={54} height={92} rx={9} className="stroke-ink" strokeWidth={3} />
      <rect x={44} y={22} width={54} height={92} rx={9} className="fill-surface" opacity={0.12} />
      {/* motion lines */}
      <path d="M22 48h14M16 62h20M24 76h12" className="stroke-accent" strokeWidth={2.5} />
      {/* direction */}
      <path d="M108 14h64" className="stroke-accent" strokeWidth={2.5} />
      <path d="M166 8l7 6-7 6" className="stroke-accent" strokeWidth={2.5} />
    </Frame>
  );
}

export function LightDiagram() {
  return (
    <Frame>
      <path d="M100 30L44 104h112z" className="fill-accent" opacity={0.18} />
      <SpineRow x={46} y={104} count={7} width={13} heights={[48, 54, 44, 52, 56, 46, 50]} />
      <circle cx={100} cy={24} r={11} className="fill-accent" />
      <path
        d="M100 4v5M100 39v4M80 24h-5M125 24h-5M86 10l3.5 3.5M114 10l-3.5 3.5M86 38l3.5-3.5M114 38l-3.5-3.5"
        className="stroke-accent"
        strokeWidth={2.5}
      />
    </Frame>
  );
}

export function GlareDiagram() {
  return (
    <Frame>
      <rect x={70} y={16} width={46} height={88} rx={3} className="fill-primary" />
      <rect x={76} y={24} width={34} height={2.5} rx={1} className="fill-accent" />
      <rect x={76} y={94} width={34} height={2.5} rx={1} className="fill-accent" />
      <path d="M82 16h22L78 104H70z" className="fill-surface" opacity={0.55} />
      <rect x={60} y={104} width={66} height={6} rx={1.5} className="fill-wood" />
      {/* flash off */}
      <circle cx={160} cy={40} r={18} className="stroke-danger" strokeWidth={2.5} />
      <path d="M163 27l-9 14h7l-4 13 10-16h-7z" className="fill-ink" />
      <path d="M147 27l26 26" className="stroke-danger" strokeWidth={2.5} />
      {/* film from the side */}
      <path d="M30 88c6-26 18-40 34-46" className="stroke-accent" strokeWidth={2.5} />
      <path d="M56 38l9 4-5 8" className="stroke-accent" strokeWidth={2.5} />
    </Frame>
  );
}

export function UprightDiagram() {
  const spines = (x: number) =>
    [0, 1, 2, 3].map((i) => (
      <rect key={i} x={x + i * 11} y={38 + (i % 2) * 6} width={9} height={46 - (i % 2) * 6} rx={1.5} className={SPINE_FILLS[i]} />
    ));
  return (
    <Frame>
      <g>
        <rect x={22} y={20} width={60} height={82} rx={9} className="fill-surface stroke-ink" strokeWidth={2.5} />
        {spines(31)}
        <rect x={28} y={84} width={48} height={4} rx={1} className="fill-wood" />
        <Check x={80} y={22} />
      </g>
      <g transform="rotate(24 150 61)">
        <rect x={120} y={20} width={60} height={82} rx={9} className="fill-surface stroke-ink" strokeWidth={2.5} />
        {spines(129)}
        <rect x={126} y={84} width={48} height={4} rx={1} className="fill-wood" />
      </g>
      <Cross x={178} y={16} />
    </Frame>
  );
}

export function ClipsDiagram() {
  const clip = (x: number, label: string) => (
    <g key={label}>
      <rect x={x} y={26} width={50} height={52} rx={5} className="fill-ink" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={x + 5 + i * 9} y={30} width={5} height={4} rx={1} className="fill-surface" opacity={0.7} />
          <rect x={x + 5 + i * 9} y={70} width={5} height={4} rx={1} className="fill-surface" opacity={0.7} />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect key={`s${i}`} x={x + 8 + i * 9} y={40 + (i % 2) * 4} width={7} height={26 - (i % 2) * 4} rx={1} className={SPINE_FILLS[(i + label.length) % SPINE_FILLS.length]} />
      ))}
      <text x={x + 25} y={98} textAnchor="middle" className="fill-muted" fontSize={12} fontWeight={700} fontFamily="Inter Variable, system-ui, sans-serif">
        {label}
      </text>
    </g>
  );
  return (
    <Frame>
      {clip(12, '1')}
      <path d="M68 52h8M72 48v8" className="stroke-accent" strokeWidth={2.5} />
      {clip(80, '2')}
      <path d="M136 52h8M140 48v8" className="stroke-accent" strokeWidth={2.5} />
      {clip(148, '3')}
    </Frame>
  );
}
