import { cn } from "@/lib/utils";
import { AnimatedGrid } from "@/components/background/animated-grid";
import { GradientMesh } from "@/components/background/gradient-mesh";

type HeroBackgroundProps = {
  className?: string;
};

/**
 * The hero's atmosphere — the full-bleed layer behind both columns.
 *
 * Just three things now: a warm gradient wash standing in for airglow, a faint
 * survey grid as if the page were being instrumented, and a fade into the
 * section below. The sky itself moved out to `HeroSky`, which is confined to
 * its own column.
 *
 * Everything here is deliberately weak enough to sit under body copy. The
 * layers that were strong enough to need a legibility scrim — the starfield,
 * the Aperture, the pointer glow — are the ones that left.
 */
export function HeroBackground({ className }: HeroBackgroundProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden bg-bg", className)}
    >
      <GradientMesh />
      {/* Dimmer than it was — ambient texture, not the main event. */}
      <AnimatedGrid className="opacity-40" animate={false} />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-bg" />
    </div>
  );
}
