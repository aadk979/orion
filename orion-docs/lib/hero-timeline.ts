import { ORION_EDGES } from "@/lib/orion-stars";

/**
 * The hero intro.
 *
 * The copy and the constellation used to fight over the middle of the screen,
 * and the fix was a long choreographed wait: the sky drew itself, held on the
 * finished figure, and only then did the words arrive. It worked, but it cost
 * four and a half seconds before anyone could read what the product was.
 *
 * The layout solves it properly — copy on the left, sky on the right, no
 * overlap at any breakpoint — so the waiting is gone. Both start at once. The
 * text is readable almost immediately and the figure takes its time drawing
 * itself alongside, which is the part worth watching anyway.
 *
 * What's left here is two independent tracks that happen to share a clock.
 * The canvas animates against a raw millisecond timestamp; framer-motion wants
 * seconds. Both are exported rather than converted at each call site.
 */

// ---- The sky ----

/**
 * Staggers are tuned against the size of the catalogue, not picked in the
 * abstract: 22 stars and 23 lines at the old 125ms/85ms spacing ran the figure
 * out past 4s, well after the Aperture had closed over it.
 */

/** ms after mount that the first (brightest) constellation star ignites. */
export const IGNITE_START_MS = 380;
export const IGNITE_STAGGER_MS = 58;
export const IGNITE_MS = 820;

export const EDGE_START_MS = 1350;
export const EDGE_STAGGER_MS = 44;
export const EDGE_DRAW_MS = 420;

/** The last asterism line lands. Scales with the catalogue, so adding stars
 *  to the figure pushes this out rather than silently getting cut off. */
export const SKY_END_MS = EDGE_START_MS + ORION_EDGES.length * EDGE_STAGGER_MS + EDGE_DRAW_MS;

/**
 * The Aperture starts while the belt is still joining up — the two reading as
 * one continuous gesture beats a visible handoff — and finishes last, closing
 * the sequence over the completed figure.
 */
export const RING_DRAW_START = 1.55;
export const RING_DRAW_DURATION = 1.5;
export const RING_ARC_STAGGER = 0.12;

// ---- The copy ----

/**
 * A short cascade, not a queue. Nothing here is waiting on the sky any more, so
 * these are only large enough to keep the block from landing as one slab —
 * everything is on screen inside three quarters of a second.
 */
export const cue = {
  badge: 0.05,
  headline: 0.15,
  lede: 0.3,
  actions: 0.42,
  terminal: 0.55,
} as const;
