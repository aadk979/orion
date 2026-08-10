import { cn } from "@/lib/utils";
import { GithubIcon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/stamp";
import { pendingCopy, source } from "@/lib/release-status";

/**
 * The "view the source" affordance, in whatever state the source is in.
 *
 * Every place on the site that wants to point at the repository goes through
 * this component — the navbar, the footer, the mobile drawer. That is not
 * consolidation for its own sake: the repository is not public yet, and a
 * single site with three hand-written GitHub links is a site that will ship
 * with at least one of them still pointing at a 404 on launch day, and at least
 * one still saying "coming soon" a month after.
 *
 * ## The two states
 *
 * **Available.** An ordinary external link. Nothing clever.
 *
 * **Pending.** Not a disabled link — *not a link at all*. A disabled link is
 * still a link to a keyboard, still announced as one by a screen reader, and
 * still something a reader will try to click twice before concluding the site
 * is broken. The pending state renders as inert text with a stamp on it, sits
 * outside the tab order entirely, and states plainly what it is: a destination
 * that does not exist yet. The mark stays, because the mark is what makes the
 * row scannable; only the destination is missing, and the stamp says so.
 */

export function SourceLink({
  /**
   * `icon` is the navbar's compact form; `inline` is the footer and drawer's
   * labelled row. They differ only in whether the word "GitHub" is set.
   */
  variant = "inline",
  className,
}: {
  variant?: "icon" | "inline";
  className?: string;
}) {
  const label = "GitHub";

  if (source.available) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex items-center gap-2 text-sm text-text-tertiary transition-colors hover:text-text-primary",
          className,
        )}
      >
        <GithubIcon className="size-4" />
        {variant === "inline" && label}
        {variant === "icon" && <span className="sr-only">{label}</span>}
      </a>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm text-text-tertiary",
        // The mark is dimmed rather than removed. Present-but-unavailable is
        // the actual state, and it is more informative than absent.
        className,
      )}
    >
      <GithubIcon className="size-4 opacity-60" />
      {variant === "inline" && <span>{label}</span>}
      {/* The stamp is a loud object and the navbar is on every page, so the
          compact form gets the quiet version of the same words. A stamp
          repeated in fixed chrome stops being an event and starts being a
          logo — which is exactly how a "coming soon" becomes invisible. */}
      {variant === "inline" ? (
        <Stamp size="sm" rotate={-3} impact={false}>
          {pendingCopy.source}
        </Stamp>
      ) : (
        <span className="border border-border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide">
          Soon
        </span>
      )}
      {/* Sighted readers get the stamp; everyone else gets the sentence. The
          stamp's own text ("Coming soon") is true but not self-explanatory when
          read out of context by a screen reader. */}
      <span className="sr-only">
        {label} — the public repository is not available yet.
      </span>
    </span>
  );
}
