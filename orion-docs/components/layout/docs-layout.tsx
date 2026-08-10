import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Sidebar, type EditionSummary } from "@/components/layout/sidebar";
import { MobileToc, Toc, type TocHeading } from "@/components/layout/toc";
import { getPrevNext, type NavNode } from "@/lib/nav-tree";
import { cn } from "@/lib/utils";

type DocsLayoutProps = {
  navTree: NavNode[];
  toc: TocHeading[];
  title?: string | null;
  description?: string | null;
  route: string;
  trail: NavNode[];
  edition: EditionSummary;
  children: ReactNode;
};

/** Three-column docs shell with matching breadcrumb and mobile heading indexes. */
export function DocsLayout({
  navTree,
  toc,
  title,
  description,
  route,
  trail,
  edition,
  children,
}: DocsLayoutProps) {
  const { prev, next } = getPrevNext(navTree, route);

  return (
    <div className="mx-auto flex w-full max-w-(--width-docs) items-start gap-10 px-4 sm:px-6 xl:gap-14">
      <Sidebar navTree={navTree} edition={edition} />

      <main className="min-w-0 flex-1 py-8 sm:py-12">
        <Breadcrumb trail={trail} edition={edition} />

        <div className="prose-orion">
          {title && <h1 className="text-balance">{title}</h1>}
          {description && <p className="mt-2! text-lg text-text-secondary">{description}</p>}
          <MobileToc headings={toc} />
          {children}
        </div>

        {(prev || next) && (
          <nav
            aria-label="Documentation pagination"
            className="mt-16 grid grid-cols-1 gap-4 border-t border-border-faint pt-8 sm:grid-cols-2"
          >
            {prev && (
              <Link
                href={prev.route}
                className="group flex flex-col gap-1 rounded-md border border-border p-4 transition-colors hover:border-border-strong"
              >
                <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
                  <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
                  Previous
                </span>
                <span className="text-sm font-medium text-text-primary">{prev.title}</span>
              </Link>
            )}
            {next && (
              <Link
                href={next.route}
                className={cn(
                  "group flex flex-col items-end gap-1 rounded-md border border-border p-4 text-right transition-colors hover:border-border-strong",
                  !prev && "sm:col-start-2",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
                  Next
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-sm font-medium text-text-primary">{next.title}</span>
              </Link>
            )}
          </nav>
        )}
      </main>

      <Toc headings={toc} />
    </div>
  );
}

function Breadcrumb({ trail, edition }: { trail: NavNode[]; edition: EditionSummary }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 overflow-hidden">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.65rem] uppercase tracking-wide">
        <li>
          {trail.length ? (
            <Link href={edition.docsHref} className="text-text-tertiary hover:text-text-primary">
              Edition {String(edition.ordinal).padStart(3, "0")}
            </Link>
          ) : (
            <span aria-current="page" className="text-text-primary">
              Edition {String(edition.ordinal).padStart(3, "0")}
            </span>
          )}
        </li>
        {trail.map((node, index) => {
          const current = index === trail.length - 1;
          return (
            <li key={node.route} className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="text-text-faint">/</span>
              {current ? (
                <span aria-current="page" className="truncate text-text-primary">
                  {node.title}
                </span>
              ) : (
                <Link href={node.route} className="truncate text-text-tertiary hover:text-text-primary">
                  {node.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
