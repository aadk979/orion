"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { useMediaQuery, usePrefersReducedMotion } from "@/hooks/use-media-query";
import { useMousePosition } from "@/hooks/use-mouse-position";
import { Button } from "@/components/ui/button";
import { Stamp } from "@/components/ui/stamp";
import {
  DrawingPlate,
  PosterBackdrop,
  Reticle,
  posterCue as cue,
  type PlateRow,
} from "@/components/versions/poster-plate";
import { fileNumber, pendingCopy } from "@/lib/release-status";
import { VERSIONS_BASE_PATH } from "@/lib/versions";

/**
 * An unissued edition's poster.
 *
 * The same sheet as `version-poster.tsx`, printed before there was anything to
 * print on it. Where the issued poster answers "what is this edition", this one
 * answers exactly one question — "is it out?" — and refuses every other. No
 * version numbers, no package manifest, no change list, no date, not even the
 * tagline. The edition's identity survives as a file number and a name in the
 * dimension callout, because the URL already says `alpine` and pretending
 * otherwise would be coy rather than restrained.
 *
 * ## Why the withholding is the design
 *
 * A "coming soon" page that lists what is coming is not a coming-soon page; it
 * is a spec sheet with a delay attached, and it invites the reader to evaluate
 * something they cannot yet have. Withholding is only legible, though, if the
 * page shows that it is withholding — a blank screen reads as unfinished, not
 * as sealed. So the manifest is not omitted, it is **redacted**: the labels
 * stay, the values are struck. The reader can see the shape of what is being
 * held back, which is the difference between a locked door and a missing wall.
 *
 * ## The register
 *
 * A records office, in the site's own drafting-room idiom: files are opened,
 * held, cleared and issued; the loud object is a rubber stamp; the vocabulary
 * is fixed in `lib/release-status.ts` so the whole site sounds like one
 * institution. The conceit is generic — forms, stamps, dockets, clearances —
 * and borrows no names, marks, mottos or characters from anyone else's.
 *
 * ## Motion
 *
 * The sheet reads in, the headline rises, and then the stamp lands on top of it
 * — one hard beat, last, and nothing moves afterwards. The order matters: a
 * stamp that arrives before the thing it is stamping has no object.
 */

/** The stamp lands after the headline has finished rising. */
const STAMP_CUE = 1.15;

/**
 * Three scalars, not an `OrionVersion`.
 *
 * This is a client component, so anything handed to it is serialised into the
 * page's RSC payload and shipped inside the HTML — *whether or not it is
 * rendered*. Passing the whole edition record put the sealed manifest, the
 * change list and the summary into `versions/alpine.html` in plain text, on the
 * one page whose entire job is not to show them.
 *
 * So the boundary is the redaction. The component receives exactly what it
 * prints and has no access to the rest, which means the withholding cannot be
 * undone by a later edit to this file — there is nothing here to leak.
 */
type PendingPosterProps = {
  ordinal: number;
  /** The edition's name. Appears once, in the dimension callout. */
  name: string;
  /** Where the documentation lives, or `null` if this edition has none. */
  docsHref: string | null;
};

export function PendingPoster({ ordinal: ordinalNumber, name, docsHref }: PendingPosterProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [sectionRef, mouse] = useMousePosition<HTMLElement>();

  /**
   * The reticle is a pointer affordance, so it is gated on an actual pointer.
   * On a touch screen it would pin itself wherever the last tap landed and stay
   * there, which reads as a rendering bug rather than an instrument.
   */
  const tracking = useMediaQuery("(hover: hover) and (min-width: 1024px)");

  const ordinal = String(ordinalNumber).padStart(3, "0");
  const form = fileNumber(ordinalNumber);

  /**
   * The title block, in the pending register. Every row is either a fact about
   * the file itself or an explicit non-answer — there is no row here whose
   * value would have to be invented, which is the same rule the issued plate
   * follows and the reason either can be trusted.
   */
  const rows: PlateRow[] = [
    ["Form", form],
    ["Status", pendingCopy.status],
    ["Issue", pendingCopy.awaiting],
    ["Docs", "Open"],
  ];

  const rise = (delay: number) =>
    reduceMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: ease.outExpo },
        };

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[92vh] items-center overflow-hidden px-6 pb-20 pt-[calc(var(--height-nav)+3rem)] lg:px-16"
    >
      {/* "File" rather than "Specimen": the giant ordinal is no longer a glyph
          being measured, it is the number on a folder. Same drawing, one word
          of difference, and the whole backdrop changes what it is about. */}
      <PosterBackdrop ordinal={ordinal} caption="File" reduceMotion={reduceMotion} />
      <DrawingPlate rows={rows} reduceMotion={reduceMotion} />
      {tracking && !reduceMotion && <Reticle mouse={mouse} />}

      <div className="relative z-10 mx-auto w-full max-w-(--width-content)">
        <motion.div {...rise(cue.badge)}>
          <Link
            href={VERSIONS_BASE_PATH}
            className="group inline-flex items-center gap-2.5 font-mono text-[0.7rem] uppercase tracking-wide text-text-faint transition-colors hover:text-text-tertiary"
          >
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span className="inline-flex items-center gap-2 border border-border px-2.5 py-1">
              {/* A square, not a dot, and blinking rather than pulsing outward.
                  A pinging dot is the universal "live" signal and this page is
                  the one page on the site that must never emit it. */}
              <span aria-hidden className="size-1.5 animate-pulse bg-accent/70" />
              Form {form} · {pendingCopy.status}
            </span>
          </Link>
        </motion.div>

        {/* Headline and its dimension callout share an inline-flex column so
            the rule measures the words rather than the container. */}
        <div className="mt-7 inline-flex max-w-full flex-col items-stretch">
          <PendingHeadline reduceMotion={reduceMotion} />
          <DimensionRule
            label={`File ${form} · ${name}`}
            delay={STAMP_CUE - 0.25}
            reduceMotion={reduceMotion}
          />
        </div>

        <div className="mt-8">
          <Stamp size="lg" rotate={-5} delay={reduceMotion ? 0 : STAMP_CUE}>
            {pendingCopy.stamp}
          </Stamp>
        </div>

        <motion.p
          {...rise(cue.tagline + 0.35)}
          className="mt-9 max-w-2xl text-lg leading-relaxed text-balance text-text-secondary md:text-xl"
        >
          Edition {ordinal} has been opened, documented and filed. It has not been issued. The
          manifest, the change record and the source stay sealed until it is — the documentation
          does not, and every page of it is open to read now.
        </motion.p>

        <motion.div {...rise(cue.actions + 0.35)} className="mt-9 flex flex-wrap items-center gap-3">
          {docsHref && (
            <Button href={docsHref} size="lg">
              Read the documentation
              <ArrowRight className="size-4" />
            </Button>
          )}
          <Button href={VERSIONS_BASE_PATH} variant="secondary" size="lg">
            Back to the timeline
          </Button>
        </motion.div>

        {/* Where the issued poster prints its package manifest, this prints the
            reason there isn't one. Same position, same type, same weight — the
            substitution is the point, and it only lands if the slot is
            recognisably the same slot. */}
        <motion.p
          {...rise(cue.billing + 0.35)}
          className="mt-14 max-w-2xl font-mono text-[0.65rem] uppercase leading-relaxed tracking-wide text-text-faint"
        >
          Manifest {pendingCopy.sealed} · Change record {pendingCopy.sealed} · Issue date{" "}
          {pendingCopy.awaiting} · Source {pendingCopy.awaiting} ·{" "}
          <span className="text-accent/70">Documentation open</span>
        </motion.p>
      </div>
    </section>
  );
}

/**
 * The two words this page exists to say, each carrying the index of its first
 * character in the whole line.
 *
 * That offset is what keeps the stagger reading as one continuous sweep across
 * both words rather than restarting at each. Computed once at module scope and
 * not with a counter incremented inside the render — a variable mutated from
 * inside a `map` callback during render is exactly the pattern React's
 * immutability lint refuses, and it is right to: the callback is not guaranteed
 * to run once per render.
 */
const HEADLINE = ["Coming", "soon."] as const;

const HEADLINE_WORDS = HEADLINE.map((word, index) => ({
  word,
  start: HEADLINE.slice(0, index).reduce((total, previous) => total + previous.length, 0),
}));

/**
 * Masked rise, one character at a time.
 *
 * Split by word first and then by character, rather than by character across
 * the whole string. A space inside an `overflow-hidden inline-block` collapses
 * to nothing, so a naive character split renders "Comingsoon." — and the words
 * have to be able to wrap as units on a narrow screen, which a flat row of
 * per-character boxes will not do.
 */
function PendingHeadline({ reduceMotion }: { reduceMotion: boolean }) {
  const text = HEADLINE.join(" ");
  const className =
    "text-5xl font-semibold tracking-tighter text-text-primary sm:text-7xl lg:text-[7.5rem]";

  if (reduceMotion) {
    return <h1 className={className}>{text}</h1>;
  }

  return (
    <h1 className={cn("flex flex-wrap gap-x-[0.26em]", className)} aria-label={text}>
      {HEADLINE_WORDS.map(({ word, start }) => (
        <span key={word} className="flex">
          {word.split("").map((glyph, index) => (
            <span key={`${glyph}-${index}`} aria-hidden className="overflow-hidden py-[0.06em]">
              <motion.span
                className="inline-block"
                initial={{ y: "110%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                transition={{
                  duration: 1,
                  ease: ease.outExpo,
                  delay: cue.name + (start + index) * cue.nameStagger,
                }}
              >
                {glyph}
              </motion.span>
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}

/**
 * A dimension callout under the headline — end ticks, a rule broken by its
 * label, drawn outward from the centre. Identical to the issued poster's, and
 * deliberately so: it is the one place the edition's real name still appears,
 * and it should look like the same measurement being taken.
 */
function DimensionRule({
  label,
  delay,
  reduceMotion,
}: {
  label: string;
  delay: number;
  reduceMotion: boolean;
}) {
  const rule = {
    initial: reduceMotion ? false : { scaleX: 0 },
    animate: { scaleX: 1 },
    transition: { duration: 0.6, delay: reduceMotion ? 0 : delay, ease: ease.outQuart },
  };

  return (
    <div className="mt-4 flex items-center gap-2">
      <span className="h-2 w-px shrink-0 bg-border-strong" />
      <motion.span {...rule} className="h-px flex-1 origin-right bg-border" />
      <motion.span
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: reduceMotion ? 0 : delay + 0.2 }}
        className="shrink-0 whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-wide text-text-faint"
      >
        {label}
      </motion.span>
      <motion.span {...rule} className="h-px flex-1 origin-left bg-border" />
      <span className="h-2 w-px shrink-0 bg-border-strong" />
    </div>
  );
}
