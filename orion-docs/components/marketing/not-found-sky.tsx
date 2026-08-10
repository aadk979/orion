import { cn } from "@/lib/utils";
import {
  magnitudeToBrightness,
  ORION_EDGES,
  ORION_HALF_HEIGHT,
  ORION_HALF_WIDTH,
  ORION_RADIUS_DEGREES,
  PROJECTED_ORION,
  type CatalogStar,
} from "@/lib/orion-stars";

/**
 * Orion with a hole in it.
 *
 * The 404's figure: the real constellation, drawn from the same catalogue the
 * hero uses, with one star taken out and a search circle left where it should
 * have been. The lines that reach for it go dashed. It says the thing the copy
 * says — we know where you were pointed, there is nothing there — without a
 * cartoon astronaut anywhere near it.
 *
 * Plain SVG, no canvas and no client boundary. The hero's sky is animated,
 * pointer-reactive and expensive; this is a static figure on a page whose whole
 * job is to get the visitor somewhere else quickly.
 */

/** ε Ori, Alnilam — the middle of the belt. Index into `PROJECTED_ORION`. */
const MISSING = 3;

/**
 * Catalogue positions are normalised to [-1, 1] on the figure's long axis, which
 * would put every stroke width and star radius in the third decimal place.
 * Everything is multiplied up so the numbers below read as numbers.
 */
const SCALE = 100;

/** Room for the search circle around the gap, which sits inside the figure. */
const PAD = 12;

const TONE: Record<CatalogStar["tone"], string> = {
  amber: "var(--orion-accent, #F0A02A)",
  blue: "#BAD3FF",
  bone: "#EDEAE3",
};

const stars = PROJECTED_ORION.map((star) => ({
  x: (star.x / ORION_RADIUS_DEGREES) * SCALE,
  y: (star.y / ORION_RADIUS_DEGREES) * SCALE,
  brightness: magnitudeToBrightness(star.mag),
  tone: star.tone,
}));

const halfWidth = ORION_HALF_WIDTH * SCALE + PAD;
const halfHeight = ORION_HALF_HEIGHT * SCALE + PAD;
const viewBox = `${-halfWidth} ${-halfHeight} ${halfWidth * 2} ${halfHeight * 2}`;

const gap = stars[MISSING];

/** Crosshair ticks around the gap — inner radius to outer, on the four axes. */
const TICKS: [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export function NotFoundSky({ className }: { className?: string }) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      aria-hidden
      className={cn("h-full w-full", className)}
    >
      <defs>
        <radialGradient id="orion-404-gap-glow">
          <stop offset="0%" stopColor="var(--orion-accent, #F0A02A)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--orion-accent, #F0A02A)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The asterism. Lines that terminate on the missing star are drawn
          broken, so the eye follows them into the gap rather than past it. */}
      {ORION_EDGES.map(([from, to]) => {
        const dangling = from === MISSING || to === MISSING;
        return (
          <line
            key={`${from}-${to}`}
            x1={stars[from].x}
            y1={stars[from].y}
            x2={stars[to].x}
            y2={stars[to].y}
            stroke="rgba(237,234,227,0.13)"
            strokeWidth={dangling ? 0.7 : 0.6}
            strokeDasharray={dangling ? "2.5 3.5" : undefined}
          />
        );
      })}

      {stars.map((star, index) =>
        index === MISSING ? null : (
          <circle
            key={index}
            cx={star.x}
            cy={star.y}
            r={0.9 + star.brightness * 2.4}
            fill={TONE[star.tone]}
            opacity={0.3 + star.brightness * 0.7}
          />
        ),
      )}

      {/* Where Alnilam should be. */}
      <g>
        <circle cx={gap.x} cy={gap.y} r={16} fill="url(#orion-404-gap-glow)" />
        <circle
          cx={gap.x}
          cy={gap.y}
          r={8}
          stroke="var(--orion-accent, #F0A02A)"
          strokeWidth={0.7}
          strokeDasharray="3 4.5"
          opacity={0.75}
          className="motion-safe:animate-[orion-pulse-glow_3.4s_ease-in-out_infinite]"
        />
        {TICKS.map(([dx, dy]) => (
          <line
            key={`${dx}:${dy}`}
            x1={gap.x + dx * 11}
            y1={gap.y + dy * 11}
            x2={gap.x + dx * 15}
            y2={gap.y + dy * 15}
            stroke="var(--orion-accent, #F0A02A)"
            strokeWidth={0.7}
            strokeLinecap="round"
            opacity={0.55}
          />
        ))}
      </g>
    </svg>
  );
}
