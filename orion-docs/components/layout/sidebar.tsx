"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavNode } from "@/lib/nav-tree";

export type EditionSummary = {
  name: string;
  ordinal: number;
  statusLabel: string;
  docsHref: string;
  archiveHref: string;
};

/**
 * The persistent documentation index. Section links and disclosure controls are
 * siblings on purpose: navigating and expanding are separate actions, and
 * nesting one interactive element inside the other produces invalid HTML.
 */
export function Sidebar({
  navTree,
  edition,
}: {
  navTree: NavNode[];
  edition?: EditionSummary;
}) {
  return (
    <aside className="sticky top-(--height-nav) hidden max-h-[calc(100svh-var(--height-nav))] shrink-0 self-start overflow-y-auto py-12 pr-2 lg:block lg:w-64">
      {edition && <EditionPlate edition={edition} />}

      <nav aria-label="Documentation" className="flex flex-col gap-0.5">
        {navTree.map((node) => (
          <SidebarNode key={node.route} node={node} depth={0} />
        ))}
      </nav>
    </aside>
  );
}

/** Which edition is being read, with a truthful route back to the edition file. */
function EditionPlate({ edition }: { edition: EditionSummary }) {
  return (
    <Link
      href={edition.archiveHref}
      className="mb-5 flex items-center gap-3 rounded-md border border-border bg-white/2 px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-white/4"
    >
      <GitBranch className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {edition.name}
        </span>
        <span className="block font-mono text-[0.65rem] uppercase tracking-wide text-text-tertiary">
          Edition {String(edition.ordinal).padStart(3, "0")} · {edition.statusLabel}
        </span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" />
    </Link>
  );
}

function SidebarNode({ node, depth }: { node: NavNode; depth: number }) {
  const pathname = usePathname();
  const regionId = useId();
  const active = pathname === node.route;
  const containsActive = pathname.startsWith(`${node.route}/`);
  const [open, setOpen] = useState(containsActive || depth === 0);
  const hasChildren = Boolean(node.children?.length);
  const expanded = open || containsActive;

  if (hasChildren) {
    return (
      <div>
        <div
          className={cn(
            "flex items-center rounded-md transition-colors",
            active || containsActive
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary",
          )}
        >
          <Link
            href={node.route}
            aria-current={active ? "page" : undefined}
            className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-sm font-medium"
          >
            {node.title}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
            aria-expanded={expanded}
            aria-controls={regionId}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-white/4 hover:text-text-primary"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-90")}
            />
          </button>
        </div>
        <div
          id={regionId}
          hidden={!expanded}
          className="ml-2.5 border-l border-border-faint pl-2.5"
        >
          {node.children?.map((child) => (
            <SidebarNode key={child.route} node={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Link
      href={node.route}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative block truncate rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active ? "text-accent-bright" : "text-text-tertiary hover:text-text-primary",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-0 -left-2.5 w-0.5 rounded-full bg-accent" />}
      {node.title}
    </Link>
  );
}
