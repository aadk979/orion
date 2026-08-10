import { Boxes, Database, Laptop, Server, ShieldCheck } from "lucide-react";
import { DiagramContainer } from "@/components/docs/diagram-container";
import { ClusterNode } from "@/components/docs/cluster-node";
import { NodeConnection } from "@/components/docs/node-connection";

const authNodes = [
  { label: "auth-node-a1", x: 24 },
  { label: "auth-node-a2", x: 50 },
  { label: "auth-node-b1", x: 76 },
];

const iconClass = "size-3.5 shrink-0 text-text-tertiary";

/** `<Architecture />` — the full Orion stack, from SDK down to storage. */
export function Architecture() {
  return (
    <DiagramContainer title="orion.architecture" badge="cluster" height={440}>
      {authNodes.map((node) => (
        <NodeConnection key={`sdk-${node.label}`} from={{ x: 50, y: 12 }} to={{ x: node.x, y: 38 }} curved />
      ))}
      {authNodes.map((node) => (
        <NodeConnection key={`ctrl-${node.label}`} from={{ x: node.x, y: 38 }} to={{ x: 50, y: 64 }} curved />
      ))}
      <NodeConnection from={{ x: 50, y: 64 }} to={{ x: 80, y: 64 }} />
      <NodeConnection from={{ x: 50, y: 64 }} to={{ x: 50, y: 90 }} />

      <ClusterNode
        label="Client SDK"
        sublabel="browser / server"
        icon={<Laptop className={iconClass} strokeWidth={1.75} />}
        style={{ left: "50%", top: "12%" }}
      />

      {authNodes.map((node, index) => (
        <ClusterNode
          key={node.label}
          label={node.label}
          sublabel="Orion-core"
          icon={<Server className={iconClass} strokeWidth={1.75} />}
          delay={index * 0.08}
          style={{ left: `${node.x}%`, top: "38%" }}
        />
      ))}

      <ClusterNode
        label="Orion-Orchestrator"
        sublabel="control plane"
        icon={<Boxes className={iconClass} strokeWidth={1.75} />}
        delay={0.28}
        style={{ left: "50%", top: "64%" }}
      />
      <ClusterNode
        label="PBAC Admin Plane"
        sublabel="panel · api · cli"
        icon={<ShieldCheck className={iconClass} strokeWidth={1.75} />}
        delay={0.34}
        style={{ left: "80%", top: "64%" }}
      />

      <ClusterNode
        label="Postgres · Redis"
        sublabel="durable state"
        icon={<Database className={iconClass} strokeWidth={1.75} />}
        delay={0.4}
        style={{ left: "50%", top: "90%" }}
      />
    </DiagramContainer>
  );
}
