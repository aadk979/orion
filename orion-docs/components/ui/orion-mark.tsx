import { cn } from "@/lib/utils";

/**
 * The Aperture — Orion's logo mark.
 *
 * Four arc segments on one circle, cut by four equal gaps, one segment in
 * amber. Inlined rather than loaded as a file because inline SVG is the only
 * form that inherits colour: the three neutral segments take `currentColor`,
 * so the mark tracks whatever text colour it sits in, while the accent stays
 * pinned to the brand token.
 *
 * Source of truth for the geometry is `/public/brand/README.md`.
 */

/** Master cut — radius 20, stroke 6, 26° gaps. */
const MASTER = {
  strokeWidth: 6,
  neutral: [
    "M51.4874 36.4990 A20 20 0 0 1 36.4990 51.4874",
    "M27.5010 51.4874 A20 20 0 0 1 12.5126 36.4990",
    "M12.5126 27.5010 A20 20 0 0 1 27.5010 12.5126",
  ],
  accent: "M36.4990 12.5126 A20 20 0 0 1 51.4874 27.5010",
};

/**
 * Small cut — radius 22, stroke 9, gaps widened to 34°. An optical correction,
 * not a second logo: at the master cut the 26° gaps close under antialiasing
 * and the mark fills in to a solid ring.
 */
const SMALL = {
  strokeWidth: 9,
  neutral: [
    "M53.0387 38.4322 A22 22 0 0 1 38.4322 53.0387",
    "M25.5678 53.0387 A22 22 0 0 1 10.9613 38.4322",
    "M10.9613 25.5678 A22 22 0 0 1 25.5678 10.9613",
  ],
  accent: "M38.4322 10.9613 A22 22 0 0 1 53.0387 25.5678",
};

/** Below this the master cut's gaps disappear, so switch cuts. */
const SMALL_CUT_THRESHOLD = 24;

type OrionMarkProps = {
  /** Rendered size in px. Drives which cut is used. */
  size?: number;
  className?: string;
  /**
   * Accessible name. Omit when the mark sits beside the "Orion" wordmark —
   * it is decorative there and would otherwise be announced twice.
   */
  title?: string;
  /**
   * Drop the amber segment and render all four in `currentColor`. For dense,
   * incidental UI only — never the primary logo spot.
   */
  mono?: boolean;
};

export function OrionMark({ size = 24, className, title, mono = false }: OrionMarkProps) {
  const cut = size < SMALL_CUT_THRESHOLD ? SMALL : MASTER;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      strokeWidth={cut.strokeWidth}
      strokeLinecap="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      /* The viewBox already carries the mark's clear space — the outer edge
         sits 9 units in on every side, which is the one-gap-width rule. Don't
         add padding on top of it. */
      className={cn("shrink-0", className)}
    >
      {cut.neutral.map((d) => (
        <path key={d} d={d} stroke="currentColor" />
      ))}
      <path
        d={cut.accent}
        stroke={mono ? "currentColor" : "var(--orion-accent, #F0A02A)"}
      />
    </svg>
  );
}

/**
 * The mark locked up with the wordmark. Wide tracking on the word is
 * deliberate — it reads as telemetry.
 */
export function OrionLockup({
  size = 22,
  className,
  wordmarkClassName,
}: {
  size?: number;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <OrionMark size={size} />
      <span
        className={cn(
          "font-mono text-sm font-medium uppercase leading-none tracking-[0.18em]",
          wordmarkClassName,
        )}
      >
        Orion
      </span>
    </span>
  );
}
