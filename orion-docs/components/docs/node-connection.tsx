"use client";

import { motion } from "framer-motion";

export type NodePoint = { x: number; y: number };

type NodeConnectionProps = {
  from: NodePoint;
  to: NodePoint;
  animated?: boolean;
  curved?: boolean;
  /**
   * How far a same-height curve bows away from the straight line, in viewBox
   * units. Positive sags downward. Ignored unless `curved` and the two points
   * sit at the same height.
   */
  bow?: number;
  color?: string;
};

/** Below this difference in y, two points count as level. */
const LEVEL_EPSILON = 0.5;

/**
 * Draws a single connector between two percentage-space points inside a
 * `DiagramContainer`. Renders as a full-bleed absolutely-positioned SVG so
 * several connections can be stacked without sharing layout state.
 */
export function NodeConnection({
  from,
  to,
  animated = true,
  curved = false,
  bow = 9,
  color = "rgba(255,255,255,0.22)",
}: NodeConnectionProps) {
  const midX = (from.x + to.x) / 2;

  // The S-curve below interpolates its control points between the two heights,
  // so when the endpoints are level every one of them lands on the same y and
  // the whole path collapses to a straight line. A return path drawn back
  // across a diagram is exactly that case, and it came out as a stray rule
  // under the row rather than as a connection. Level pairs get a plain bow
  // instead — one control point, pushed clear of the straight line.
  const level = Math.abs(to.y - from.y) < LEVEL_EPSILON;

  let path: string;
  if (!curved) {
    path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  } else if (level) {
    // A quadratic reaches half its control point's offset, so the deepest
    // point of the arc sits `bow / 2` below the endpoints.
    path = `M ${from.x} ${from.y} Q ${midX} ${from.y + bow}, ${to.x} ${to.y}`;
  } else {
    path = `M ${from.x} ${from.y} Q ${midX} ${from.y}, ${midX} ${(from.y + to.y) / 2} T ${to.x} ${to.y}`;
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={path} stroke={color} strokeWidth={0.4} fill="none" vectorEffect="non-scaling-stroke" />
      {animated && (
        <motion.path
          d={path}
          stroke="rgba(var(--color-accent-rgb), 0.9)"
          strokeWidth={0.6}
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeDasharray="4 10"
          animate={{ strokeDashoffset: [0, -28] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
        />
      )}
    </svg>
  );
}
