import { Children, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type StepProps = {
  title: string;
  children: ReactNode;
};

export function Step({ children }: StepProps) {
  return <>{children}</>;
}

type StepsProps = {
  children: ReactNode;
  className?: string;
};

export function Steps({ children, className }: StepsProps) {
  const steps = Children.toArray(children).filter(isValidElement) as React.ReactElement<StepProps>[];

  return (
    <ol className={cn("not-prose relative my-6 space-y-8 pl-0", className)}>
      {steps.map((step, index) => (
        <li key={step.props.title} className="relative flex gap-4 pl-0">
          <div className="relative flex shrink-0 flex-col items-center">
            <span className="flex size-8 items-center justify-center rounded-full border border-border-strong bg-bg-elevated font-mono text-xs font-medium text-text-primary">
              {index + 1}
            </span>
            {index < steps.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <p className="mb-1.5 font-medium text-text-primary">{step.props.title}</p>
            <div className="text-sm leading-relaxed text-text-secondary [&>p]:my-2 [&>p:first-child]:mt-0">
              {step.props.children}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
