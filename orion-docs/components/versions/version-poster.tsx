"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { useMediaQuery, usePrefersReducedMotion } from "@/hooks/use-media-query";
import { useMousePosition } from "@/hooks/use-mouse-position";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DrawingPlate,
  PosterBackdrop,
  Reticle,
  posterCue as cue,
  type PlateRow,
} from "@/components/versions/poster-plate";
import {
  VERSIONS_BASE_PATH,
  developmentDays,
  formatVersionDate,
  publicationLabel,
  versionDocsRoute,
  type OrionVersion,
} from "@/lib/versions";

/**
 * An issued edition's poster.
 *
 * One screen that has to answer "what is this edition" before anyone decides
 * whether to read its documentation — so it is built like a poster and not like
 * a page: the name at display size, one line under it, the dates, and the way
 * in. Everything else is below the fold, on purpose.
 *
 * The sheet it is printed on comes from `poster-plate.tsx`; this file is only
 * what is printed. See `pending-poster.tsx` for the same sheet before an
 * edition has been issued.
 *
 * This component assumes a publication date exists. That is not a soft
 * assumption — the meta row, the title block and the span callout all print one
 * — so the edition page picks between this and the pending poster rather than
 * this one degrading. A poster that can render either state ends up saying
 * neither convincingly.
 */
export function VersionPoster({ version }: { version: OrionVersion }) {
  const reduceMotion = usePrefersReducedMotion();
  const [sectionRef, mouse] = useMousePosition<HTMLElement>();

  /**
   * The reticle is a pointer affordance, so it is gated on an actual pointer.
   * On a touch screen it would pin itself wherever the last tap landed and stay
   * there, which reads as a rendering bug rather than an instrument.
   */
  const tracking = useMediaQuery("(hover: hover) and (min-width: 1024px)");

  const ordinal = String(version.ordinal).padStart(3, "0");
  const span = developmentDays(version);

  const rows: PlateRow[] = [
    ["Sheet", `${ordinal} / ${ordinal}`],
    ["Issued", publicationLabel(version)],
    ["Status", version.status === "current" ? "Current" : "Archived"],
    ...(span === null ? [] : ([["Span", `${span} days`]] as PlateRow[])),
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
      <PosterBackdrop ordinal={ordinal} reduceMotion={reduceMotion} />
      <DrawingPlate rows={rows} reduceMotion={reduceMotion} />
      {tracking && !reduceMotion && <Reticle mouse={mouse} />}

      <div className="relative z-10 mx-auto w-full max-w-(--width-content)">
        <motion.div {...rise(cue.badge)}>
          <Link href={VERSIONS_BASE_PATH} className="group inline-flex items-center gap-2">
            <ArrowLeft className="size-3.5 text-text-faint transition-transform group-hover:-translate-x-0.5" />
            <Badge tone={version.status === "current" ? "accent" : "neutral"}>
              {version.status === "current" && (
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
                </span>
              )}
              Edition {ordinal} · {version.status === "current" ? "Current" : "Archived"}
            </Badge>
          </Link>
        </motion.div>

        {/* Wordmark and its dimension callout share an inline-flex column so
            the rule measures the name rather than the container. */}
        <div className="mt-7 inline-flex flex-col items-stretch">
          <EditionName name={version.name} reduceMotion={reduceMotion} />
          {span !== null && (
            <DimensionRule
              label={`Span · ${span} days`}
              delay={cue.name + version.name.length * cue.nameStagger + 0.15}
              reduceMotion={reduceMotion}
            />
          )}
        </div>

        <motion.p
          {...rise(cue.tagline)}
          className="mt-6 max-w-2xl text-xl leading-relaxed text-balance text-text-secondary md:text-2xl"
        >
          {version.tagline}
        </motion.p>

        <motion.dl
          {...rise(cue.meta)}
          className="mt-10 flex max-w-3xl flex-wrap items-center gap-x-10 gap-y-4 border-y border-border-faint py-5"
        >
          <MetaEntry term="Branched" value={formatVersionDate(version.branchedOn)} />
          <MetaEntry term="Published" value={publicationLabel(version)} />
          <MetaEntry
            term="Documentation"
            value={
              version.hasDocs ? `${version.highlights.length} headline changes` : "Not published"
            }
          />
        </motion.dl>

        <motion.div {...rise(cue.actions)} className="mt-9 flex flex-wrap items-center gap-3">
          {version.hasDocs && (
            <Button href={versionDocsRoute(version)} size="lg">
              Read the {version.name} docs
              <ArrowRight className="size-4" />
            </Button>
          )}
          <Button href="#what-changed" variant="secondary" size="lg">
            What changed
          </Button>
        </motion.div>

        {/* The billing block, in the poster sense — the small type along the
            bottom nobody reads first and everybody checks eventually. Capped
            short of full width so it never runs into the title block. */}
        <motion.div
          {...rise(cue.billing)}
          className="mt-14 flex max-w-2xl flex-wrap gap-x-8 gap-y-3 font-mono text-[0.65rem] uppercase tracking-wide text-text-faint"
        >
          {version.packages.map((pkg) => (
            <span key={pkg.name} className="inline-flex items-baseline gap-1.5">
              {pkg.name}
              <span className="text-text-tertiary">{pkg.version}</span>
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ---- The copy ----

/** Masked rise, one character at a time. The one piece of real choreography here. */
function EditionName({ name, reduceMotion }: { name: string; reduceMotion: boolean }) {
  const className =
    "text-6xl font-semibold tracking-tighter text-text-primary sm:text-7xl lg:text-[7.5rem]";

  if (reduceMotion) {
    return <h1 className={className}>{name}</h1>;
  }

  return (
    <h1 className={cn("flex", className)} aria-label={name}>
      {name.split("").map((character, index) => (
        <span key={`${character}-${index}`} aria-hidden className="overflow-hidden py-[0.06em]">
          <motion.span
            className="inline-block"
            initial={{ y: "110%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              duration: 1,
              ease: ease.outExpo,
              delay: cue.name + index * cue.nameStagger,
            }}
          >
            {character}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

/**
 * A dimension callout under the wordmark — end ticks, a rule broken by its
 * label, drawn outward from the centre once the name has landed.
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

function MetaEntry({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[0.65rem] uppercase tracking-wide text-text-faint">{term}</dt>
      <dd className="mt-1 text-sm text-text-secondary">{value}</dd>
    </div>
  );
}
