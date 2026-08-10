"use client";

import { useMemo } from "react";
import type { Heading } from "nextra";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveHeading } from "@/hooks/use-active-heading";

export type TocHeading = Heading;

export function Toc({ headings }: { headings: TocHeading[] }) {
  const ids = useMemo(() => headings.map((heading) => heading.id), [headings]);
  const activeId = useActiveHeading(ids);

  if (headings.length === 0) return null;

  return (
    <aside className="sticky top-(--height-nav) hidden max-h-[calc(100svh-var(--height-nav))] shrink-0 self-start overflow-y-auto py-12 xl:block xl:w-60">
      <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        On this page · {String(headings.length).padStart(2, "0")}
      </p>
      <ul className="space-y-2 border-l border-border-faint">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: `${(heading.depth - 2) * 0.75 + 0.75}rem` }}>
            <a
              href={`#${heading.id}`}
              aria-current={activeId === heading.id ? "location" : undefined}
              className={cn(
                "-ml-px block border-l pl-3 text-sm transition-colors duration-150",
                activeId === heading.id
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary",
              )}
            >
              {heading.value}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** A no-JavaScript heading index for long pages where the desktop rail is hidden. */
export function MobileToc({ headings }: { headings: TocHeading[] }) {
  if (headings.length === 0) return null;

  return (
    <details className="group not-prose my-7 rounded-md border border-border bg-white/[0.02] xl:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-text-primary marker:hidden">
        <span className="font-mono text-[0.65rem] uppercase tracking-wide text-text-tertiary">
          Page index
        </span>
        <span className="text-text-secondary">{headings.length} sections</span>
        <ChevronDown className="ml-auto size-4 text-text-tertiary transition-transform group-open:rotate-180" />
      </summary>
      <ol className="border-t border-border-faint px-4 py-3">
        {headings.map((heading, index) => (
          <li key={heading.id} className="flex gap-3 py-1.5 text-sm">
            <span aria-hidden className="font-mono text-[0.65rem] tabular-nums text-text-faint">
              {String(index + 1).padStart(2, "0")}
            </span>
            <a
              href={`#${heading.id}`}
              className="text-text-secondary hover:text-text-primary"
              style={{ marginLeft: `${Math.max(0, heading.depth - 2) * 0.5}rem` }}
            >
              {heading.value}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
