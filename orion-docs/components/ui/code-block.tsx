"use client";

import { useRef, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { Check, Copy, FileCode2, WrapText } from "lucide-react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";

type CodeBlockProps = Omit<HTMLAttributes<HTMLPreElement>, "children"> & {
  "data-filename"?: string;
  "data-copy"?: string;
  "data-word-wrap"?: string;
  children?: ReactNode;
};

/** MDX `pre` override — wraps Shiki/rehype-pretty-code output in window chrome. */
export function CodeBlock({
  children,
  className,
  "data-filename": filename,
  "data-copy": dataCopy,
  "data-word-wrap": dataWordWrap,
  ...rest
}: CodeBlockProps) {
  const showCopy = dataCopy !== undefined;
  const supportsWrap = dataWordWrap !== undefined;
  const codeRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);

  async function handleCopy() {
    const text = codeRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      // Only on success — a copy the visitor didn't get isn't a copy. The
      // language comes off the `data-language` rehype-pretty-code puts on the
      // `pre`, so it needs no prop of its own.
      track("copy_code", {
        code_filename: filename,
        code_language: codeRef.current?.dataset.language,
        code_length: text.length,
        page_path: window.location.pathname,
      });
    } catch {
      // Clipboard API unavailable — fail silently.
    }
  }

  const toolbar = (showCopy || supportsWrap) && (
    <div className="flex items-center gap-1">
      {supportsWrap && (
        <ToolbarButton
          active={wrapped}
          label="Toggle word wrap"
          onClick={() => setWrapped((w) => !w)}
        >
          <WrapText className="size-3.5" />
        </ToolbarButton>
      )}
      {showCopy && (
        <ToolbarButton label="Copy code" onClick={handleCopy}>
          {copied ? (
            <Check className="size-3.5 text-emerald-400" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </ToolbarButton>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "orion-code-block group not-prose relative my-6 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-(--shadow-sm)",
        className,
      )}
    >
      {filename ? (
        <div className="flex h-10 items-center gap-2 border-b border-border-faint bg-white/[0.02] px-4 text-xs text-text-tertiary">
          <FileCode2 className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate font-mono">{filename}</span>
          <div className="ml-auto">{toolbar}</div>
        </div>
      ) : (
        toolbar && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [&_button]:pointer-events-auto">
            {toolbar}
          </div>
        )
      )}
      <pre ref={codeRef} className={cn(wrapped && "[&>code]:orion-wrap")} {...rest}>
        {children}
      </pre>
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  active,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-sm border transition-colors duration-150",
        active
          ? "border-accent-dim bg-accent/10 text-accent-bright"
          : "border-border bg-bg-elevated text-text-tertiary hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
