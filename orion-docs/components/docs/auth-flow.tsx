import { Database, KeyRound, ShieldCheck, User } from "lucide-react";
import { DiagramContainer } from "@/components/docs/diagram-container";
import { ClusterNode } from "@/components/docs/cluster-node";
import { NodeConnection } from "@/components/docs/node-connection";

const steps = [
  { label: "Client", sublabel: "browser SDK", icon: User, x: 12 },
  { label: "Orion Node", sublabel: "verify + issue", icon: ShieldCheck, x: 38 },
  { label: "Postgres", sublabel: "users · tokens", icon: Database, x: 64 },
  { label: "Cookie pair", sublabel: "access · refresh", icon: KeyRound, x: 90 },
];

/**
 * Where the row of nodes sits, and where the return path runs, as percentages
 * of the diagram's height.
 *
 * The row is above centre on purpose. The forward line runs through the middle
 * of the cards and is meant to disappear behind them, surfacing only in the
 * gaps; the return path has to be unmistakably clear of them, or it reads as a
 * border on the row rather than as a path back to the client. At the previous
 * values the gap between the two was eight pixels.
 */
const ROW_Y = 42;
const RETURN_Y = 74;

/** `<AuthFlow />` — request/response sequence for an Orion sign-in exchange. */
export function AuthFlow() {
  return (
    <DiagramContainer title="auth.sequence" badge="sign-in" height={200}>
      {steps.slice(0, -1).map((step, index) => (
        <NodeConnection
          key={step.label}
          from={{ x: step.x, y: ROW_Y }}
          to={{ x: steps[index + 1].x, y: ROW_Y }}
        />
      ))}

      {/* The token pair travelling back to the client, under the whole row. */}
      <NodeConnection
        from={{ x: 90, y: RETURN_Y }}
        to={{ x: 12, y: RETURN_Y }}
        curved
        bow={11}
      />

      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <ClusterNode
            key={step.label}
            label={step.label}
            sublabel={step.sublabel}
            icon={<Icon className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={1.75} />}
            delay={index * 0.1}
            style={{ left: `${step.x}%`, top: `${ROW_Y}%` }}
          />
        );
      })}
    </DiagramContainer>
  );
}
