import { Boxes, Server, ShieldCheck } from "lucide-react";
import { DiagramContainer } from "@/components/docs/diagram-container";
import { ClusterNode } from "@/components/docs/cluster-node";
import { NodeConnection } from "@/components/docs/node-connection";

const nodes = [
  { label: "auth-node-a1", sublabel: "us-east-1", x: 22, y: 78 },
  { label: "auth-node-a2", sublabel: "us-east-1", x: 50, y: 78 },
  { label: "auth-node-b1", sublabel: "eu-west-1", x: 78, y: 78 },
];

const iconClass = "size-3.5 shrink-0 text-text-tertiary";

/** `<ClusterDiagram />` — Orion-Orchestrator supervising a fleet of auth nodes. */
export function ClusterDiagram() {
  return (
    <DiagramContainer title="cluster.topology" badge="live" height={280}>
      {nodes.map((node) => (
        <NodeConnection key={node.label} from={{ x: 50, y: 22 }} to={{ x: node.x, y: node.y }} curved />
      ))}

      <ClusterNode
        label="Orion-Orchestrator"
        sublabel="control plane"
        icon={<Boxes className={iconClass} strokeWidth={1.75} />}
        status="healthy"
        style={{ left: "50%", top: "22%" }}
      />

      {nodes.map((node, index) => (
        <ClusterNode
          key={node.label}
          label={node.label}
          sublabel={node.sublabel}
          icon={<Server className={iconClass} strokeWidth={1.75} />}
          status="healthy"
          delay={index * 0.08}
          style={{ left: `${node.x}%`, top: `${node.y}%` }}
        />
      ))}

      <ClusterNode
        label="R_Sync transport"
        sublabel="ecdh · aes-gcm"
        icon={<ShieldCheck className={iconClass} strokeWidth={1.75} />}
        status="healthy"
        delay={0.32}
        style={{ left: "50%", top: "50%" }}
        className="border-dashed !bg-transparent opacity-70"
      />
    </DiagramContainer>
  );
}
