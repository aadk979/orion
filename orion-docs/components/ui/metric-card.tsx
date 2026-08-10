import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
};

export function MetricCard({ label, value, hint, icon: Icon, className }: MetricCardProps) {
  return (
    <Card hoverable={false} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {label}
        </span>
        {Icon && <Icon className="size-4 text-text-faint" strokeWidth={1.75} />}
      </div>
      <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-text-primary">
        {value}
      </span>
      {hint && <span className="text-xs text-text-tertiary">{hint}</span>}
    </Card>
  );
}
