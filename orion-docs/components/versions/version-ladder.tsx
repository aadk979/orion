"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer, viewportOnce } from "@/lib/motion";
import {
  branches,
  ORIGIN_DATE,
} from "@/lib/version-timeline";
import { formatVersionDate, isPending, publicationLabel, versionRoute, versions } from "@/lib/versions";

/**
 * The thread, stood on end.
 *
 * `VersionThread` is a wide horizontal drawing — it needs roughly a thousand
 * pixels before the plates stop colliding, which a phone does not have. Rather
 * than shrink it into illegibility this renders the same sequence vertically:
 * origin, every edition, today, then the branches fraying off the end.
 *
 * Same data, same order, same links. Only the axis changes.
 */
export function VersionLadder({ className }: { className?: string }) {
  return (
    <motion.ol
      variants={staggerContainer(0.05)}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      className={cn("relative", className)}
    >
      <Rung marker={<span className="block size-2 rounded-full border border-border-strong bg-bg" />}>
        <p className="font-mono text-[0.65rem] uppercase tracking-wide text-text-faint">
          Origin · {formatVersionDate(ORIGIN_DATE)}
        </p>
        <p className="mt-1 text-sm text-text-tertiary">
          The first commit, before there was an edition to name.
        </p>
      </Rung>

      {versions.map((version) => (
        <Rung
          key={version.slug}
          marker={
            <span className="relative flex items-center justify-center">
              {version.status === "current" && (
                <span className="absolute size-3.5 animate-ping rounded-full bg-accent/40" />
              )}
              {/* Hollow and dashed while pending, matching the wide thread's
                  node — the two drawings are the same drawing on two axes and
                  must agree about what a node means. */}
              <span
                className={cn(
                  "relative block size-3 rounded-full",
                  isPending(version)
                    ? "border-[1.5px] border-dashed border-accent/70 bg-bg"
                    : "bg-accent shadow-[0_0_0_4px_rgba(var(--color-accent-rgb),0.16)]",
                )}
              />
            </span>
          }
        >
          <Link
            href={versionRoute(version)}
            className="group block rounded-lg border border-border bg-bg-raised/60 px-4 py-3 transition-colors hover:border-accent-dim"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-mono text-[0.65rem] uppercase tracking-wide text-text-faint">
                Edition {String(version.ordinal).padStart(3, "0")} ·{" "}
                {isPending(version) ? "Not yet issued" : publicationLabel(version)}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-lg font-semibold tracking-tight text-text-primary transition-colors group-hover:text-accent-bright">
              {version.name}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
              {version.tagline}
            </span>
          </Link>
        </Rung>
      ))}

      <Rung marker={<span className="block h-3 w-px bg-accent/60" />}>
        <p className="font-mono text-[0.65rem] uppercase tracking-wide text-accent-bright">
          Today
        </p>
        <p className="mt-1 text-sm text-text-tertiary">
          The record ends here. Everything below is a direction, not a release.
        </p>
      </Rung>

      {branches.map((branch) => (
        <Rung
          key={branch.title}
          faded
          marker={<span className="block size-1.5 rounded-full bg-accent/40" />}
        >
          <p className="text-sm font-medium text-text-tertiary">{branch.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-faint">{branch.note}</p>
        </Rung>
      ))}
    </motion.ol>
  );
}

function Rung({
  marker,
  faded,
  children,
}: {
  marker: React.ReactNode;
  /** The unwritten branches — dashed rail, to match the thread's dashed stubs. */
  faded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.li variants={fadeUp} className="relative flex gap-4 pb-7 last:pb-0">
      <div className="relative flex w-3 shrink-0 flex-col items-center pt-1.5">
        {marker}
        <span
          aria-hidden
          className={cn(
            "mt-1.5 w-px flex-1",
            faded
              ? "bg-[repeating-linear-gradient(to_bottom,rgba(var(--color-accent-rgb),0.25)_0_3px,transparent_3px_9px)]"
              : "bg-gradient-to-b from-accent/50 to-accent/15",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </motion.li>
  );
}
