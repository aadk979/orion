import { cn } from "@/lib/utils";

type AnimatedGridProps = {
  className?: string;
  fade?: "radial" | "bottom";
  /**
   * Pan the grid. Off in the hero: the starfield already supplies the motion,
   * a second drifting layer just adds noise, and on software rasterisers the
   * moving grid under a mask was measured costing roughly half the frame rate
   * for something nobody notices.
   */
  animate?: boolean;
};

/** One grid cell. The drift travels exactly this far, so the loop is seamless. */
const CELL = 64;

/**
 * A slowly-panning wireframe grid, faded toward the edges so it reads as
 * ambient texture rather than a hard pattern.
 *
 * The pan is a `transform` on an oversized inner layer, not an animated
 * `background-position`. Background-position repaints the whole masked
 * viewport every frame; a transform is handed to the compositor and costs
 * essentially nothing. The inner layer is inset by one cell on every side so
 * the translate never exposes an edge.
 */
export function AnimatedGrid({ className, fade = "radial", animate = true }: AnimatedGridProps) {
  const mask =
    fade === "radial"
      ? "radial-gradient(ellipse 70% 60% at 50% 30%, black 0%, transparent 75%)"
      : "linear-gradient(to bottom, black 0%, transparent 90%)";

  return (
    // The mask already clips, so no `overflow-hidden` — one less clip for the
    // compositor to apply to a layer that moves every frame.
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <div
        className={cn(
          "absolute opacity-[0.35]",
          animate && "motion-safe:animate-[orion-grid-drift_18s_linear_infinite]",
        )}
        style={{
          inset: `-${CELL}px`,
          backgroundImage:
            "linear-gradient(to right, rgba(237,234,227,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(237,234,227,0.07) 1px, transparent 1px)",
          backgroundSize: `${CELL}px ${CELL}px`,
          // Promote to its own layer so the masked parent composites a ready
          // texture instead of repainting the grid under the mask each frame.
          ...(animate ? { willChange: "transform" as const } : null),
        }}
      />
    </div>
  );
}
