"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, X } from "lucide-react";
import { ease } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { primaryNav } from "@/lib/site-config";
import type { NavNode } from "@/lib/nav-tree";
import { SourceLink } from "@/components/ui/source-link";
import { OrionLockup } from "@/components/ui/orion-mark";
import type { EditionSummary } from "@/components/layout/sidebar";
import { cn } from "@/lib/utils";

type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  navTree: NavNode[];
  edition: EditionSummary;
};

/** The phone navigation exposes the same complete docs tree as the desktop index. */
export function MobileDrawer({ open, onClose, navTree, edition }: MobileDrawerProps) {
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const dialogRef = useModalDialog({ open, onClose, initialFocusRef: closeRef });

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 768px)");
    function onViewportChange(event: MediaQueryListEvent) {
      if (event.matches) onClose();
    }
    desktop.addEventListener("change", onViewportChange);
    return () => desktop.removeEventListener("change", onViewportChange);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <motion.div
        aria-hidden
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="fixed inset-0 z-100 bg-black/60 backdrop-blur-sm md:hidden"
      />
      <motion.div
        ref={dialogRef}
        id="mobile-navigation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-navigation-title"
        tabIndex={-1}
        initial={reduceMotion ? false : { x: "100%" }}
        animate={{ x: 0 }}
        transition={{ duration: 0.35, ease: ease.outExpo }}
        className="fixed inset-y-0 right-0 z-101 flex w-[90%] max-w-sm flex-col border-l border-border bg-bg-elevated md:hidden"
      >
        <div className="flex items-center justify-between border-b border-border-faint px-5 py-4">
          <div>
            <OrionLockup size={20} className="text-text-primary" />
            <p id="mobile-navigation-title" className="mt-1 font-mono text-[0.6rem] uppercase tracking-wide text-text-tertiary">
              Navigation register
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-md text-text-tertiary hover:bg-white/4 hover:text-text-primary"
          >
            <X className="size-4.5" />
          </button>
        </div>

        <nav aria-label="Primary and documentation navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-2 pb-2 font-mono text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Explore
          </p>
          {primaryNav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-2 py-2 text-sm font-medium hover:bg-white/4 hover:text-text-primary",
                  active ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {item.title}
              </Link>
            );
          })}

          <div className="mx-2 mt-5 flex items-end justify-between border-b border-border-faint pb-2">
            <div>
              <p className="text-sm font-medium text-text-primary">{edition.name} docs</p>
              <p className="font-mono text-[0.6rem] uppercase tracking-wide text-text-tertiary">
                Edition {String(edition.ordinal).padStart(3, "0")} · {edition.statusLabel}
              </p>
            </div>
            <span aria-hidden className="font-mono text-[0.6rem] text-text-faint">
              INDEX
            </span>
          </div>
          <div className="mt-2">
            {navTree.map((node) => (
              <MobileNavNode key={node.route} node={node} pathname={pathname} onNavigate={onClose} />
            ))}
          </div>
        </nav>

        <div className="border-t border-border-faint px-5 py-4">
          <SourceLink />
        </div>
      </motion.div>
    </>
  );
}

function MobileNavNode({
  node,
  pathname,
  onNavigate,
  depth = 0,
}: {
  node: NavNode;
  pathname: string;
  onNavigate: () => void;
  depth?: number;
}) {
  const regionId = useId();
  const active = pathname === node.route;
  const containsActive = pathname.startsWith(`${node.route}/`);
  const hasChildren = Boolean(node.children?.length);
  const [open, setOpen] = useState(containsActive);
  const expanded = open || containsActive;

  if (!hasChildren) {
    return (
      <Link
        href={node.route}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "block rounded-md py-2 pr-2 text-sm hover:bg-white/4 hover:text-text-primary",
          active ? "text-accent-bright" : "text-text-secondary",
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
      >
        {node.title}
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center rounded-md hover:bg-white/4">
        <Link
          href={node.route}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "min-w-0 flex-1 truncate py-2 pr-2 text-sm font-medium",
            active || containsActive ? "text-text-primary" : "text-text-secondary",
          )}
          style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
        >
          {node.title}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
          aria-expanded={expanded}
          aria-controls={regionId}
          className="mr-1 flex size-8 items-center justify-center rounded-sm text-text-tertiary hover:text-text-primary"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
      </div>
      <div id={regionId} hidden={!expanded} className="ml-2 border-l border-border-faint pl-1">
        {node.children?.map((child) => (
          <MobileNavNode
            key={child.route}
            node={child}
            pathname={pathname}
            onNavigate={onNavigate}
            depth={depth + 1}
          />
        ))}
      </div>
    </div>
  );
}
