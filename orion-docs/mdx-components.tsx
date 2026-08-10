import type { MDXComponents } from "mdx/types";
import type { AnchorHTMLAttributes } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { CodeBlock } from "@/components/ui/code-block";
import { Callout } from "@/components/ui/callout";
import { Badge } from "@/components/ui/badge";
import { InfoBox } from "@/components/ui/info-box";
import { Alert } from "@/components/ui/alert";
import { MetricCard } from "@/components/ui/metric-card";
import { Grid } from "@/components/ui/grid";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, Tab } from "@/components/ui/tabs";
import { Steps, Step } from "@/components/ui/steps";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Terminal } from "@/components/ui/terminal";
import { Timeline } from "@/components/ui/timeline";
import { TableScroll } from "@/components/ui/table-scroll";

import { AuthFlow } from "@/components/docs/auth-flow";
import { ClusterDiagram } from "@/components/docs/cluster-diagram";
import { Architecture } from "@/components/docs/architecture-diagram";
import { ProtocolTimeline } from "@/components/docs/protocol-timeline";
import { DiagramContainer } from "@/components/docs/diagram-container";
import { ClusterNode } from "@/components/docs/cluster-node";
import { NodeConnection } from "@/components/docs/node-connection";
import { Warning } from "@/components/docs/warning";
import { Info } from "@/components/docs/info";

const EXTERNAL_URL_RE = /^https?:\/\//;

function Anchor({ href = "", children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (EXTERNAL_URL_RE.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
        <ArrowUpRight className="ml-0.5 inline-block size-3.5 align-baseline" />
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

const orionComponents: MDXComponents = {
  a: Anchor as MDXComponents["a"],
  pre: CodeBlock as MDXComponents["pre"],
  table: TableScroll as MDXComponents["table"],

  Callout,
  Badge,
  InfoBox,
  Alert,
  MetricCard,
  Grid,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Tabs,
  Tab,
  Steps,
  Step,
  Accordion,
  AccordionItem,
  Terminal,
  Timeline,

  AuthFlow,
  ClusterDiagram,
  Architecture,
  ProtocolTimeline,
  DiagramContainer,
  ClusterNode,
  NodeConnection,
  Warning,
  Info,
};

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...orionComponents, ...components };
}
