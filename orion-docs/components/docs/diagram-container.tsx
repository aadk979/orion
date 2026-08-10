"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type DiagramContainerProps = {
  title: string;
  badge?: string;
  children: ReactNode;
  className?: string;
  height?: number;
};

/**
 * Design-space width the child nodes are positioned against. The whole canvas
 * is scaled uniformly to fit the available width, so percentage-positioned
 * nodes keep their proportions (and never overlap) on narrow / mobile screens.
 */
const DESIGN_WIDTH = 720;

/** Shared window-chrome frame for the diagram components below. */
export function DiagramContainer({ title, badge, children, className, height = 320 }: DiagramContainerProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / DESIGN_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("not-prose my-8 overflow-hidden rounded-lg border border-border bg-bg-raised", className)}>
      <div className="flex items-center gap-2 border-b border-border-faint bg-white/[0.02] px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
        </span>
        <span className="ml-2 text-xs font-medium text-text-secondary">{title}</span>
        {badge && (
          <span className="ml-auto rounded-full border border-accent-dim/60 bg-accent/10 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-accent-bright">
            {badge}
          </span>
        )}
      </div>
      <div
        ref={plotRef}
        className="relative w-full overflow-hidden"
        style={{
          height: height * scale,
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      >
        <div className="absolute inset-0 flex justify-center">
          <div
            className="origin-top"
            style={{ width: DESIGN_WIDTH, height, flex: "0 0 auto", transform: `scale(${scale})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
