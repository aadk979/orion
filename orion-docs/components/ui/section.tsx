import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SectionProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  sm: "py-16 md:py-[var(--space-section-sm)]",
  md: "py-20 md:py-[var(--space-section-md)]",
  lg: "py-24 md:py-[var(--space-section-lg)]",
} as const;

export function Section({ as: Tag = "section", size = "md", className, children, ...props }: SectionProps) {
  return (
    <Tag className={cn("relative", sizeClasses[size], className)} {...props}>
      <div className="mx-auto w-full max-w-(--width-content) px-6">{children}</div>
    </Tag>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  headingAs: Heading = "h2",
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  headingAs?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-12 max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && (
        <span className="mb-3 inline-block text-xs font-medium uppercase tracking-wide text-accent-bright">
          {eyebrow}
        </span>
      )}
      <Heading className="text-3xl font-semibold tracking-tight text-balance text-text-primary md:text-4xl">
        {title}
      </Heading>
      {description && (
        <p className="mt-4 text-lg leading-relaxed text-text-secondary">{description}</p>
      )}
    </div>
  );
}