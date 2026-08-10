import { versions, unwrittenBranches, type OrionVersion } from "@/lib/versions";

/**
 * Geometry for the branching thread at `/versions`.
 *
 * The thread is drawn twice over: an SVG layer carries the strokes, and an HTML
 * layer carries every node, label and link on top of it. That split is what
 * makes the nodes real links — focusable, hoverable, announced — instead of
 * `<circle>` elements pretending to be buttons.
 *
 * The two layers only line up because they share this file. The SVG uses the
 * viewBox below; the HTML positions itself in percentages of the same box, and
 * the container is pinned to the viewBox's aspect ratio so one unit means the
 * same thing to both. Change `VIEWBOX` and the ratio has to move with it.
 */

export const VIEWBOX = { width: 1200, height: 360 } as const;

export type Point = { x: number; y: number };

/** Percentage coordinates for the HTML layer, from a viewBox point. */
export function toPercent(point: Point): { left: string; top: string } {
  return {
    left: `${(point.x / VIEWBOX.width) * 100}%`,
    top: `${(point.y / VIEWBOX.height) * 100}%`,
  };
}

/** Where the repository begins — the first commit, before there was an edition. */
export const ORIGIN: Point = { x: 70, y: 262 };

/**
 * The date that origin marks. Taken from the first edition's `branchedOn`
 * rather than written down twice — the repository started when the first
 * edition started, and if that is ever untrue it should be untrue in one place.
 */
export const ORIGIN_DATE: string = versions[0].branchedOn;

/** Today. The thread thins out past this point because nothing there exists yet. */
export const HORIZON: Point = { x: 860, y: 176 };

/** The thread runs on a little further, so the horizon isn't a dead end. */
const TERMINUS: Point = { x: 1150, y: 158 };

/**
 * Editions are spread across a fixed span and drift upward as they get newer,
 * so the thread climbs rather than running flat. A lone edition sits at the
 * midpoint of the span instead of on top of the origin.
 */
const SPAN = { from: 300, to: 800, top: 186, bottom: 240 } as const;

export function editionPoint(index: number, total: number): Point {
  const t = total <= 1 ? 0.5 : index / (total - 1);
  return {
    x: SPAN.from + t * (SPAN.to - SPAN.from),
    y: SPAN.bottom - t * (SPAN.bottom - SPAN.top),
  };
}

export type EditionNode = { version: OrionVersion; point: Point };

export const editionNodes: EditionNode[] = versions.map((version, index) => ({
  version,
  point: editionPoint(index, versions.length),
}));

/**
 * A smooth curve through every anchor, with both control handles laid
 * horizontally. Handles on the x-axis only mean the curve arrives at each node
 * travelling flat, so a node never sits on a visible kink — and it keeps the
 * path monotonic in x, which is what makes it read as time.
 */
function smoothPath(points: Point[]): string {
  if (points.length < 2) return "";

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const handle = (to.x - from.x) * 0.45;
    d += ` C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
  }

  return d;
}

/** Origin through every edition, up to today. Solid, and drawn first. */
export const SPINE_PATH = smoothPath([
  ORIGIN,
  ...editionNodes.map((node) => node.point),
  HORIZON,
]);

/** Past today. Same thread, thinner and fading — nothing has landed here. */
export const SPINE_AHEAD_PATH = smoothPath([HORIZON, TERMINUS]);

/**
 * Branch stubs off the horizon, one per unwritten direction. Hand-placed
 * rather than generated: they want to fan out at visibly different angles and
 * lengths, which is the one thing an even distribution will not give you.
 */
const BRANCH_SHAPES: { d: string; end: Point }[] = [
  { d: `M ${HORIZON.x} ${HORIZON.y} C 930 176, 950 104, 1004 84`, end: { x: 1004, y: 84 } },
  { d: `M ${HORIZON.x} ${HORIZON.y} C 930 176, 960 214, 1010 240`, end: { x: 1010, y: 240 } },
  { d: `M ${HORIZON.x} ${HORIZON.y} C 940 176, 975 288, 1016 320`, end: { x: 1016, y: 320 } },
];

export type Branch = {
  title: string;
  short: string;
  note: string;
  d: string;
  end: Point;
};

/**
 * Zipped against the shapes, so an extra roadmap entry doesn't silently draw
 * itself off the side of the canvas — it just doesn't get a stub until someone
 * places one.
 */
export const branches: Branch[] = unwrittenBranches
  .slice(0, BRANCH_SHAPES.length)
  .map((branch, index) => ({ ...branch, ...BRANCH_SHAPES[index] }));

// ---- Choreography ----

/** The thread draws itself origin-first, left to right. */
export const DRAW_DURATION = 1.2;
/** Branches wait for the spine to reach the horizon before splitting off it. */
export const BRANCH_DELAY = DRAW_DURATION * 0.78;
export const BRANCH_STAGGER = 0.1;
/** One lap of the pulse that runs the thread once it's drawn. */
export const PULSE_DURATION = 4;

/**
 * When a node's marker lands: at the moment the drawing stroke passes through
 * it. Approximated from the node's share of the horizontal span rather than by
 * measuring the path — the spine is monotonic in x and close enough to evenly
 * paced that the difference is under a frame.
 */
export function nodeCue(point: Point): number {
  const progress = (point.x - ORIGIN.x) / (HORIZON.x - ORIGIN.x);
  return DRAW_DURATION * Math.max(0, Math.min(1, progress));
}
