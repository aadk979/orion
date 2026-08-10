"use client";

import { useId, useMemo, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import type { NavNode } from "@/lib/nav-tree";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { track } from "@/lib/analytics";

const SEARCH_SETTLE_MS = 700;

type SearchRecord = {
  node: NavNode;
  trail: string[];
};

function buildSearchIndex(tree: NavNode[], trail: string[] = []): SearchRecord[] {
  return tree.flatMap((node) => [
    { node, trail },
    ...(node.children ? buildSearchIndex(node.children, [...trail, node.title]) : []),
  ]);
}

/** Route-aware documentation search presented as a compact archive catalog. */
export function SearchBar({ navTree, className }: { navTree: NavNode[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotion();
  const dialogId = useId();
  const titleId = useId();
  const resultsId = useId();
  const optionPrefix = useId();
  const dialogRef = useModalDialog({ open, onClose: () => setOpen(false), initialFocusRef: inputRef });

  const index = useMemo(() => buildSearchIndex(navTree), [navTree]);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return index.slice(0, 8);
    return index
      .filter(({ node, trail }) =>
        [node.title, node.route, ...trail].some((value) =>
          value.toLocaleLowerCase().includes(normalized),
        ),
      )
      .slice(0, 8);
  }, [index, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector('[aria-modal="true"]') && !open) return;
        setOpen((value) => {
          if (!value) track("search_open", { search_source: "shortcut" });
          return !value;
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!term) return;
    const timer = setTimeout(() => {
      track("search", { search_term: term.slice(0, 100), result_count: results.length });
    }, SEARCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query, results.length]);

  function go(route: string) {
    track("select_search_result", {
      search_term: query.trim().slice(0, 100) || undefined,
      result_route: route,
    });
    router.push(route);
    setOpen(false);
    setQuery("");
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      go(results[activeIndex].node.route);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          track("search_open", { search_source: "button" });
          setOpen(true);
        }}
        aria-label="Search documentation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        className={cn(
          "items-center gap-2 rounded-full border border-border bg-white/3 px-2.5 py-1.5 text-sm text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary sm:px-3",
          className,
        )}
      >
        <Search className="size-3.5" />
        <span className="hidden lg:inline">Search docs</span>
        <kbd className="hidden rounded-sm border border-border bg-white/4 px-1.5 py-0.5 font-mono text-[0.65rem] text-text-tertiary lg:inline">
          ⌘/Ctrl K
        </kbd>
      </button>

      {open && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-100 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm sm:pt-[15vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <motion.div
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: ease.outExpo }}
            className="w-full max-w-xl overflow-hidden rounded-lg border border-border-strong bg-bg-elevated shadow-(--shadow-lg)"
          >
            <div className="border-b border-border-faint px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 id={titleId} className="text-sm font-medium text-text-primary">
                    Search documentation
                  </h2>
                  <p className="font-mono text-[0.6rem] uppercase tracking-wide text-text-tertiary">
                    Edition catalog · {index.length} records
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close search"
                  className="flex size-8 items-center justify-center rounded-md text-text-tertiary hover:bg-white/4 hover:text-text-primary"
                >
                  <X className="size-4" />
                </button>
              </div>
              <label className="flex items-center gap-2.5 rounded-md border border-border bg-bg-raised px-3 py-2.5 focus-within:border-border-strong">
                <span className="sr-only">Search the documentation</span>
                <Search className="size-4 text-text-tertiary" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onInputKeyDown}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={resultsId}
                  aria-activedescendant={results[activeIndex] ? `${optionPrefix}-${activeIndex}` : undefined}
                  placeholder="Search titles, sections, or routes..."
                  className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </label>
            </div>

            <p className="sr-only" aria-live="polite">
              {results.length} {results.length === 1 ? "result" : "results"}
            </p>
            <div id={resultsId} role="listbox" aria-label="Documentation search results" className="max-h-[55vh] overflow-y-auto p-2 sm:max-h-80">
              {results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-text-tertiary">
                  No matching records. Try a section name or route.
                </p>
              )}
              {results.map(({ node, trail }, resultIndex) => {
                const selected = resultIndex === activeIndex;
                return (
                  <button
                    key={node.route}
                    id={`${optionPrefix}-${resultIndex}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    onMouseMove={() => setActiveIndex(resultIndex)}
                    onClick={() => go(node.route)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors",
                      selected ? "bg-white/6" : "hover:bg-white/4",
                    )}
                  >
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-accent" strokeWidth={1.75} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-text-primary">{node.title}</span>
                      <span className="block truncate font-mono text-[0.65rem] text-text-tertiary">
                        {trail.length ? trail.join(" / ") : "Section index"}
                      </span>
                    </span>
                    <span aria-hidden className="ml-auto mt-0.5 shrink-0 font-mono text-[0.6rem] text-text-faint">
                      {String(resultIndex + 1).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
