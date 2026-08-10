"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import {
  formatVersionDate,
  isPending,
  publicationLabel,
  versionRoute,
  type OrionVersion,
} from "@/lib/versions";
import {
  BRANCH_DELAY,
  BRANCH_STAGGER,
  DRAW_DURATION,
  HORIZON,
  ORIGIN,
  ORIGIN_DATE,
  PULSE_DURATION,
  SPINE_AHEAD_PATH,
  SPINE_PATH,
  VIEWBOX,
  branches,
  editionNodes,
  nodeCue,
  toPercent,
  type Point,
} from "@/lib/version-timeline";

/**
 * The thread.
 *
 * One line, drawn from the repository's first commit through every edition on
 * file, thinning out where the record stops and fraying into the directions the
 * work is visibly heading. Editions are the only things on it you can click,
 * because they are the only things on it that exist — an edition that has been
 * opened but not issued still exists, and is drawn as a hollow node rather than
 * left off the thread.
 *
 * Two layers, sharing one coordinate system (`lib/version-timeline.ts`): an SVG
 * that draws strokes and nothing else, and an HTML layer above it holding every
 * node, label and link. The nodes are real anchors rather than `<circle>`
 * elements with click handlers, so keyboard and screen-reader users get the
 * same timeline everyone else does.
 *
 * The aspect ratio here is not decorative — it is what makes percentages in the
 * HTML layer mean the same thing as user units in the SVG. It has to track
 * `VIEWBOX`.
 */
export function VersionThread({ className }: { className?: string }) {
  const reduceMotion = usePrefersReducedMotion();

  /** Drawn state, reached instantly when the reader has asked for no motion. */
  const draw = (delay = 0, duration = DRAW_DURATION) =>
    reduceMotion
      ? { initial: { pathLength: 1 }, animate: { pathLength: 1 }, transition: { duration: 0 } }
      : {
          initial: { pathLength: 0 },
          animate: { pathLength: 1 },
          transition: { duration, delay, ease: ease.outQuart },
        };

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ aspectRatio: `${VIEWBOX.width} / ${VIEWBOX.height}` }}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        className="absolute inset-0 size-full overflow-visible"
        fill="none"
        aria-hidden
      >
        <defs>
          {/* The thread starts as dim as the origin marker and only reaches
              full amber around the editions — the past is documented, not
              lit up. */}
          <linearGradient id="thread-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.3" />
            <stop offset="60%" stopColor="var(--color-accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-accent-bright)" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="thread-ahead" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="branch-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Deep background glow */}
        <motion.path
          d={SPINE_PATH}
          stroke="var(--color-accent)"
          strokeOpacity={0.06}
          strokeWidth={24}
          strokeLinecap="round"
          {...draw()}
        />
        {/* Bloom */}
        <motion.path
          d={SPINE_PATH}
          stroke="var(--color-accent)"
          strokeOpacity={0.12}
          strokeWidth={12}
          strokeLinecap="round"
          {...draw()}
        />
        <motion.path
          d={SPINE_PATH}
          stroke="url(#thread-stroke)"
          strokeWidth={2.5}
          strokeLinecap="round"
          {...draw()}
        />

        {/* Past today. Same thread, dashed and fading out. */}
        <motion.path
          d={SPINE_AHEAD_PATH}
          stroke="url(#thread-ahead)"
          strokeWidth={2}
          strokeDasharray="1 6"
          strokeLinecap="round"
          {...draw(BRANCH_DELAY, DRAW_DURATION * 0.5)}
        />

        {branches.map((branch, index) => (
          <g key={branch.title}>
            <motion.path
              d={branch.d}
              stroke="var(--color-accent)"
              strokeOpacity={0.08}
              strokeWidth={8}
              strokeLinecap="round"
              {...draw(BRANCH_DELAY + index * BRANCH_STAGGER, DRAW_DURATION * 0.55)}
            />
            <motion.path
              d={branch.d}
              stroke="url(#branch-stroke)"
              strokeWidth={1.5}
              strokeDasharray="2 5"
              strokeLinecap="round"
              {...draw(BRANCH_DELAY + index * BRANCH_STAGGER, DRAW_DURATION * 0.55)}
            />
          </g>
        ))}

        {/* A short bright segment running the thread, once it is drawn.
            `pathLength`/`pathOffset` are normalised, so the segment is 5% of
            the line however long the line gets as editions are added. */}
        {!reduceMotion && (
          <>
            <motion.path
              d={SPINE_PATH}
              stroke="var(--color-accent)"
              strokeWidth={8}
              strokeLinecap="round"
              pathLength={0.15}
              initial={{ pathOffset: -0.15, opacity: 0 }}
              animate={{ pathOffset: 1, opacity: [0, 0.4, 0.4, 0] }}
              transition={{
                duration: PULSE_DURATION,
                delay: DRAW_DURATION,
                repeat: Infinity,
                repeatDelay: 0.8,
                ease: "linear",
                opacity: { duration: PULSE_DURATION, times: [0, 0.1, 0.9, 1], repeat: Infinity, repeatDelay: 0.8 },
              }}
            />
            <motion.path
              d={SPINE_PATH}
              stroke="var(--color-accent-bright)"
              strokeWidth={3}
              strokeLinecap="round"
              pathLength={0.05}
              initial={{ pathOffset: -0.05, opacity: 0 }}
              animate={{ pathOffset: 1, opacity: [0, 1, 1, 0] }}
              transition={{
                duration: PULSE_DURATION,
                delay: DRAW_DURATION,
                repeat: Infinity,
                repeatDelay: 0.8,
                ease: "linear",
                opacity: { duration: PULSE_DURATION, times: [0, 0.08, 0.9, 1], repeat: Infinity, repeatDelay: 0.8 },
              }}
            />
          </>
        )}
      </svg>

      {/* ---- The HTML layer ---- */}

      <Marker point={ORIGIN} delay={0} reduceMotion={reduceMotion}>
        <span className="block size-2 rounded-full border border-border-strong bg-bg" />
        <Caption className="top-4">
          <span className="text-text-tertiary">Origin</span>
          <span className="text-text-faint">{formatVersionDate(ORIGIN_DATE)}</span>
        </Caption>
      </Marker>

      {editionNodes.map(({ version, point }) => (
        <EditionNode
          key={version.slug}
          version={version}
          point={point}
          delay={nodeCue(point)}
          reduceMotion={reduceMotion}
        />
      ))}

      <Marker point={HORIZON} delay={DRAW_DURATION} reduceMotion={reduceMotion}>
        <span className="block h-5 w-px bg-gradient-to-b from-accent/60 to-transparent" />
        <Caption className="top-6">
          <span className="text-accent-bright">Today</span>
          <span className="text-text-faint">the record ends here</span>
        </Caption>
      </Marker>

      {branches.map((branch, index) => (
        <Marker
          key={branch.title}
          point={branch.end}
          delay={BRANCH_DELAY + index * BRANCH_STAGGER + 0.4}
          reduceMotion={reduceMotion}
        >
          <span className="block size-1.5 rounded-full bg-accent/40" />
          <span className="absolute left-3 top-1/2 w-32 -translate-y-1/2 font-mono text-[0.6rem] uppercase leading-tight tracking-wide text-text-faint">
            {branch.short}
          </span>
        </Marker>
      ))}
    </div>
  );
}

/**
 * A zero-size box pinned to a point on the thread. Everything inside it
 * positions itself against that point and is free to overflow — which is the
 * whole trick, and why nothing here has a width that could push the layout
 * around.
 */
function Marker({
  point,
  delay,
  reduceMotion,
  children,
  className,
}: {
  point: Point;
  delay: number;
  reduceMotion: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={cn("absolute flex size-0 items-center justify-center", className)}
      style={toPercent(point)}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, delay: reduceMotion ? 0 : delay, ease: ease.outExpo }}
    >
      {children}
    </motion.div>
  );
}

function Caption({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "absolute flex w-32 flex-col items-center gap-0.5 text-center font-mono text-[0.6rem] uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * An edition. The one kind of node on the thread that goes somewhere, so it is
 * the one kind rendered as a link — with its plate above the line and its
 * marker sitting on it.
 */
function EditionNode({
  version,
  point,
  delay,
  reduceMotion,
}: {
  version: OrionVersion;
  point: Point;
  delay: number;
  reduceMotion: boolean;
}) {
  const current = version.status === "current";
  const pending = isPending(version);

  return (
    <Marker point={point} delay={delay} reduceMotion={reduceMotion}>
      <Link
        href={versionRoute(version)}
        aria-label={
          pending
            ? `${version.name} — edition ${version.ordinal}, on file and not yet issued`
            : `${version.name} — edition ${version.ordinal}, published ${publicationLabel(version)}`
        }
        className="group absolute inset-0 flex items-center justify-center outline-none"
      >
        {/* The plate, above the line. */}
        <span className="absolute bottom-5 flex w-44 flex-col items-center rounded-lg border border-border bg-bg-elevated/85 px-3 py-2.5 text-center backdrop-blur-sm transition-colors duration-200 group-hover:border-accent-dim group-focus-visible:border-accent group-focus-visible:ring-2 group-focus-visible:ring-accent/40">
          <span className="font-mono text-[0.6rem] uppercase tracking-wide text-text-faint">
            Edition {String(version.ordinal).padStart(3, "0")}
          </span>
          <span className="mt-0.5 text-base font-semibold tracking-tight text-text-primary transition-colors group-hover:text-accent-bright">
            {version.name}
          </span>
          <span
            className={cn(
              "mt-1 font-mono text-[0.65rem] uppercase tracking-wide",
              pending ? "text-text-faint" : "text-text-tertiary",
            )}
          >
            {pending ? "Not yet issued" : publicationLabel(version)}
          </span>
        </span>

        {/* The marker, on the line.
            Three states, and the difference between them is the point: a
            shipped edition is a filled node, the current one glows and pings,
            and a pending one is a hollow ring — present on the thread, not yet
            filled in. Nothing pending is allowed to ping; that animation is the
            site's "live" signal and this node is the opposite of live. */}
        <span className="absolute flex items-center justify-center">
          {current && !reduceMotion && (
            <span className="absolute size-3.5 animate-ping rounded-full bg-accent/40" />
          )}
          <span
            className={cn(
              "relative block rounded-full transition-transform duration-200 group-hover:scale-125",
              current &&
                "size-3 bg-accent shadow-[0_0_0_4px_rgba(var(--color-accent-rgb),0.16),0_0_18px_rgba(var(--color-accent-rgb),0.65)]",
              pending && "size-3 border-[1.5px] border-dashed border-accent/70 bg-bg",
              !current && !pending && "size-2.5 border border-accent-dim bg-bg-elevated",
            )}
          />
        </span>
      </Link>
    </Marker>
  );
}
