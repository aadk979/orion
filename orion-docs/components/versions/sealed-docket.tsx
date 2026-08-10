"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer, viewportOnce } from "@/lib/motion";
import { pendingCopy } from "@/lib/release-status";

/**
 * The docket for an unissued edition.
 *
 * A list of the things a reader came here for, with every one of them struck
 * out — except the one that isn't. That exception is the entire point of the
 * component: five sealed rows exist to make the sixth, open row mean something.
 * A page that only says "no" gives a reader nothing to do; this one says "no,
 * no, no, no, no, and the documentation is right here."
 *
 * ## Redaction on a dark ground
 *
 * The obvious redaction is a black bar, and on this site's near-black page that
 * is an invisible bar. So the strike is inverted: the value area is filled with
 * a fine diagonal hatch in bone at very low alpha — visible as texture, opaque
 * as information — with the status word set over it in mono. It reads as
 * "covered" rather than "empty", which is the distinction the whole idea rests
 * on. An empty cell looks like a bug; a hatched one looks like a decision.
 *
 * The hatch is a repeating linear gradient rather than an image: it costs no
 * request, scales with the row, and cannot fail to load.
 */

export type DocketEntry = {
  /** What the row is. Always shown — the labels are not the secret. */
  term: string;
  /** One line on why this is withheld, or what it will be. Never a value. */
  note: string;
  /** `sealed` is withheld; `awaiting` does not exist yet; `open` is available. */
  state: "sealed" | "awaiting" | "open";
  /** Only for `open` rows — the thing the reader can actually go and do. */
  href?: string;
  action?: string;
};

const stateLabel: Record<DocketEntry["state"], string> = {
  sealed: pendingCopy.sealed,
  awaiting: pendingCopy.awaiting,
  open: "Open",
};

export function SealedDocket({ entries }: { entries: DocketEntry[] }) {
  return (
    <motion.dl
      variants={staggerContainer(0.07)}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      className="overflow-hidden rounded-lg border border-border"
    >
      {entries.map((entry) => (
        <motion.div
          key={entry.term}
          variants={fadeUp}
          className="grid items-center gap-x-6 gap-y-2 border-b border-border-faint px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_11rem]"
        >
          <div className="min-w-0">
            <dt className="text-sm font-medium text-text-primary">{entry.term}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-text-tertiary">
              {entry.note}
              {entry.state === "open" && entry.href && entry.action && (
                <>
                  {" "}
                  <Link
                    href={entry.href}
                    className="group inline-flex items-center gap-1 font-medium text-accent-bright"
                  >
                    {entry.action}
                    <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </>
              )}
            </dd>
          </div>

          {/* The value column. Same width on every row, so the sealed ones line
              up into a single struck-through band and the open one visibly
              breaks it. */}
          <div className="sm:justify-self-end">
            <StatusCell state={entry.state} />
          </div>
        </motion.div>
      ))}
    </motion.dl>
  );
}

/** Hatched fill for a withheld value. Bone at low alpha, 45°, 5px pitch. */
const HATCH =
  "repeating-linear-gradient(45deg, rgba(237,234,227,0.075) 0 1px, transparent 1px 5px)";

function StatusCell({ state }: { state: DocketEntry["state"] }) {
  const withheld = state !== "open";

  return (
    <span
      className={cn(
        "flex h-8 w-full items-center justify-center border font-mono text-[0.65rem] uppercase tracking-[0.18em] sm:w-44",
        withheld
          ? "border-border text-text-faint"
          : "border-accent-dim/70 bg-accent/10 text-accent-bright",
      )}
      style={withheld ? { backgroundImage: HATCH } : undefined}
    >
      {stateLabel[state]}
    </span>
  );
}
