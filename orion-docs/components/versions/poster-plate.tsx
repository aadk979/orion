"use client";

import { useRef } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import type { MousePosition } from "@/hooks/use-mouse-position";
import { AnimatedGrid } from "@/components/background/animated-grid";
import { GradientMesh } from "@/components/background/gradient-mesh";

/**
 * The sheet an edition poster is drawn on.
 *
 * Orion is infrastructure, and every edition page is presented as a drawing
 * filed in an office: a ruled border with registration marks, a graduated scale
 * along the top, a title block in the corner, the ordinal set enormous as a
 * type specimen with its construction geometry left visible, and a pointer
 * reticle reading out normalised coordinates.
 *
 * All of it is held at bone-at-ten-percent and 10px mono. The rule the whole
 * composition obeys: **the instrumentation must never be the first thing you
 * read.** If the eye lands anywhere but the headline, the opacity is wrong.
 *
 * This module is the chrome only — the frame and its atmosphere, with no
 * opinion about what is printed inside it. That is what lets an issued edition
 * and an unissued one share a sheet while saying entirely different things on
 * it; see `version-poster.tsx` and `pending-poster.tsx`. Extracting it is not
 * tidiness for its own sake: two hand-maintained copies of a ruled frame drift,
 * and a drifted frame is immediately visible when a reader moves between the
 * two pages.
 *
 * Every value the chrome prints is passed in by the caller and comes from the
 * registry. None of it is invented, because a spec sheet that lies about its
 * own measurements is just a texture.
 */

/** The plate is on screen inside a second. Nothing here waits on anything. */
export const posterCue = {
  frame: 0.05,
  ruler: 0.4,
  badge: 0.16,
  name: 0.24,
  nameStagger: 0.045,
  tagline: 0.6,
  meta: 0.72,
  actions: 0.82,
  billing: 0.95,
  titleBlock: 1,
  /** The read-in sweep runs once, while the frame is still drawing. */
  scan: 0.3,
} as const;

/** A title-block row. Term on the left, value on the right, both mono. */
export type PlateRow = readonly [term: string, value: string];

/**
 * The ruled border, its registration marks, the scale along the top and the
 * title block in the corner — everything that makes the section read as a sheet
 * rather than a hero.
 *
 * One container so the whole plate shares an inset: the ruler and the title
 * block position themselves against the frame's edges, not the viewport's, and
 * they cannot drift apart when the inset changes.
 */
export function DrawingPlate({
  rows,
  reduceMotion,
}: {
  rows: readonly PlateRow[];
  reduceMotion: boolean;
}) {
  /**
   * Each edge unrolls from the corner the previous one finished at, so the
   * border draws itself as one continuous stroke around the sheet.
   *
   * Only along its own axis. Scaling a 1px rule on both axes at once collapses
   * its thickness to nothing and then grows it back, which reads as the line
   * fading in rather than being drawn — and undoes the entire point.
   */
  const edge = (index: number, axis: "x" | "y") => ({
    initial: reduceMotion ? false : axis === "x" ? { scaleX: 0 } : { scaleY: 0 },
    animate: { scaleX: 1, scaleY: 1 },
    transition: {
      duration: 0.7,
      delay: reduceMotion ? 0 : posterCue.frame + index * 0.09,
      ease: ease.outQuart,
    },
  });

  return (
    <div aria-hidden className="pointer-events-none absolute inset-4 z-10 lg:inset-8">
      <motion.span
        {...edge(0, "x")}
        className="absolute inset-x-0 top-0 h-px origin-left bg-border"
      />
      <motion.span
        {...edge(1, "y")}
        className="absolute inset-y-0 right-0 w-px origin-top bg-border"
      />
      <motion.span
        {...edge(2, "x")}
        className="absolute inset-x-0 bottom-0 h-px origin-right bg-border"
      />
      <motion.span
        {...edge(3, "y")}
        className="absolute inset-y-0 left-0 w-px origin-bottom bg-border"
      />

      {/* Registration marks. Amber, because on a real proof sheet these are the
          one thing printed in a colour you would notice. */}
      {(
        [
          "left-0 top-0 border-l border-t",
          "right-0 top-0 border-r border-t",
          "right-0 bottom-0 border-r border-b",
          "left-0 bottom-0 border-l border-b",
        ] as const
      ).map((placement, index) => (
        <motion.span
          key={placement}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.4,
            delay: reduceMotion ? 0 : posterCue.frame + 0.5 + index * 0.06,
          }}
          className={cn("absolute size-4 border-accent/45", placement)}
        />
      ))}

      <EdgeScale reduceMotion={reduceMotion} />
      <TitleBlock rows={rows} reduceMotion={reduceMotion} />
      {!reduceMotion && <ReadInSweep />}
    </div>
  );
}

/** Graduations every 2.5% of the plate, labelled every tenth. */
const TICKS = Array.from({ length: 41 }, (_, index) => index);

/**
 * The scale along the top edge.
 *
 * Ticks are positioned in percentages rather than drawn with a repeating
 * gradient, which is the cheaper option and was the first one tried. It cannot
 * work here: a gradient repeats on a pixel pitch while the labels sit on
 * percentages, so the two agreed at exactly one viewport width and visibly
 * drifted apart at every other.
 */
function EdgeScale({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: reduceMotion ? 0 : posterCue.ruler }}
      className="absolute inset-x-0 top-0 hidden h-3 md:block"
    >
      {TICKS.map((tick) => {
        const major = tick % 4 === 0;
        // The corners already carry a registration mark; a tick under it just
        // thickens the mark into a smudge.
        if (tick === 0 || tick === TICKS.length - 1) return null;

        return (
          <span
            key={tick}
            className={cn(
              "absolute top-0 w-px",
              major ? "h-2.5 bg-border-strong" : "h-1.5 bg-border",
            )}
            style={{ left: `${tick * 2.5}%` }}
          />
        );
      })}

      {TICKS.filter((tick) => tick % 4 === 0 && tick !== 0 && tick !== TICKS.length - 1).map(
        (tick) => (
          <span
            key={tick}
            className="absolute top-3.5 -translate-x-1/2 font-mono text-[0.55rem] tabular-nums tracking-wide text-text-faint"
            style={{ left: `${tick * 2.5}%` }}
          >
            {String(tick * 2.5).padStart(3, "0")}
          </span>
        ),
      )}
    </motion.div>
  );
}

/**
 * The title block. Bottom-right, where a drawing's always is.
 *
 * Hidden below `lg`: it is reference matter, and on a narrow screen it would
 * either sit under the call-to-action buttons or push the poster taller than
 * the viewport to avoid them. Every value it shows is repeated in the page's
 * own copy, so nothing is lost by dropping it.
 */
function TitleBlock({
  rows,
  reduceMotion,
}: {
  rows: readonly PlateRow[];
  reduceMotion: boolean;
}) {
  return (
    <motion.dl
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.6,
        delay: reduceMotion ? 0 : posterCue.titleBlock,
        ease: ease.outExpo,
      }}
      className="absolute bottom-0 right-0 hidden w-56 border-l border-t border-border bg-bg/40 backdrop-blur-[2px] lg:block"
    >
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="grid grid-cols-[4.5rem_1fr] border-b border-border-faint last:border-b-0"
        >
          <dt className="border-r border-border-faint px-2.5 py-1.5 font-mono text-[0.55rem] uppercase tracking-wide text-text-faint">
            {term}
          </dt>
          <dd className="px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-text-tertiary">
            {value}
          </dd>
        </div>
      ))}
    </motion.dl>
  );
}

/**
 * A single amber line drawn down the plate as it arrives, as if the sheet were
 * being read in. It runs once and never again — a loop here would turn a nice
 * opening beat into something blinking in the reader's peripheral vision for as
 * long as they stay on the page.
 *
 * The travelling element is a full-height carrier with the line pinned to its
 * bottom edge, moved by a percentage of its own height. Animating the line's
 * `top` directly is the obvious way to write this and the wrong one: `top` is a
 * layout property, so every frame of the sweep costs a layout pass on a plate
 * that is already compositing a gradient wash and a raking light.
 */
function ReadInSweep() {
  return (
    <motion.span
      initial={{ y: "-100%", opacity: 0 }}
      animate={{ y: "0%", opacity: [0, 0.9, 0.9, 0] }}
      transition={{
        duration: 1.5,
        delay: posterCue.scan,
        ease: ease.inOut,
        opacity: { duration: 1.5, delay: posterCue.scan, times: [0, 0.12, 0.8, 1] },
      }}
      className="absolute inset-x-0 top-0 flex h-full items-end"
    >
      <span className="h-px w-full bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
    </motion.span>
  );
}

// ---- The reticle ----

/**
 * Crosshairs on the pointer, with a normalised readout.
 *
 * Driven entirely by motion values: the lines are transforms and the numbers
 * are written straight to the DOM. Nothing here re-renders React, which matters
 * because the alternative — pointer position in state — would re-render the
 * whole poster on every mouse move.
 */
export function Reticle({ mouse }: { mouse: MousePosition }) {
  const left = useTransform(mouse.x, (value) => `${value * 100}%`);
  const top = useTransform(mouse.y, (value) => `${value * 100}%`);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <motion.span
        style={{ left }}
        className="absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-accent/20 to-transparent"
      />
      <motion.span
        style={{ top }}
        className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent"
      />
      <motion.div
        style={{ left, top }}
        className="absolute flex translate-x-3 translate-y-3 gap-2 font-mono text-[0.55rem] tabular-nums tracking-wide text-text-faint"
      >
        <span>
          X<Readout value={mouse.x} />
        </span>
        <span>
          Y<Readout value={mouse.y} />
        </span>
      </motion.div>
    </div>
  );
}

/**
 * A number that tracks a motion value without re-rendering.
 *
 * The initial text has to be the motion value's own initial — 0.5, dead centre
 * — or the server renders one number, the client hydrates with another, and
 * React tears the whole subtree down over a decoration.
 */
function Readout({ value }: { value: MotionValue<number> }) {
  const ref = useRef<HTMLSpanElement>(null);

  useMotionValueEvent(value, "change", (latest) => {
    if (ref.current) ref.current.textContent = latest.toFixed(3);
  });

  return (
    <span ref={ref} className="ml-1 text-text-tertiary">
      0.500
    </span>
  );
}

// ---- Atmosphere ----

/**
 * The ordinal is set enormous, cropped by the right edge, and left standing in
 * its own construction geometry — a bounding box with corner ticks and a centre
 * line, the way a type specimen sheet shows a glyph being measured rather than
 * used. Type that runs off the sheet is the one trick that makes a web page
 * read as printed.
 */
export function PosterBackdrop({
  ordinal,
  /** What the specimen is captioned. The one word that changes between plates. */
  caption = "Specimen",
  reduceMotion,
}: {
  ordinal: string;
  caption?: string;
  reduceMotion: boolean;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-bg">
      <GradientMesh />
      <AnimatedGrid className="opacity-40" animate={false} />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, x: 60 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.6, ease: ease.outExpo }}
        className="absolute -right-10 top-1/2 hidden -translate-y-1/2 lg:block"
      >
        <span
          className="block select-none font-mono text-[22rem] font-semibold leading-none tracking-tighter text-transparent xl:text-[30rem]"
          style={{ WebkitTextStroke: "1px rgba(237,234,227,0.055)" }}
        >
          {ordinal}
        </span>

        {/* Construction geometry over the specimen. Inset vertically because
            `leading-none` boxes a glyph with slack above and below it, and a
            box drawn on the line box rather than the letterforms sits visibly
            proud of the digits it is supposed to be measuring. */}
        <span className="absolute inset-x-0 inset-y-[9%] border border-dashed border-[rgba(237,234,227,0.05)]" />
        <span className="absolute inset-x-0 top-1/2 h-px bg-[rgba(237,234,227,0.04)]" />
        {(
          [
            "left-0 top-[9%] -translate-x-1/2 -translate-y-1/2",
            "right-0 top-[9%] translate-x-1/2 -translate-y-1/2",
            "left-0 bottom-[9%] -translate-x-1/2 translate-y-1/2",
            "right-0 bottom-[9%] translate-x-1/2 translate-y-1/2",
          ] as const
        ).map((placement) => (
          <span
            key={placement}
            className={cn("absolute size-1 bg-[rgba(237,234,227,0.12)]", placement)}
          />
        ))}
        <span className="absolute -top-1 left-0 font-mono text-[0.55rem] uppercase tracking-wide text-[rgba(237,234,227,0.14)]">
          {caption} · {ordinal}
        </span>
      </motion.div>

      {/* A slow raking light across the whole sheet. `screen` so it only ever
          adds — over the near-black ground a normal-blended white bar reads as
          a grey wash rather than a highlight. */}
      {!reduceMotion && (
        <motion.div
          className="absolute -inset-y-1/2 w-[45%] mix-blend-screen"
          style={{
            background:
              "linear-gradient(100deg, transparent 0%, rgba(var(--color-accent-rgb),0.05) 45%, rgba(237,234,227,0.045) 55%, transparent 100%)",
            rotate: "12deg",
          }}
          initial={{ x: "-70%" }}
          animate={{ x: "260%" }}
          transition={{ duration: 9, repeat: Infinity, repeatDelay: 5, ease: "easeInOut" }}
        />
      )}

      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-bg" />
    </div>
  );
}
