import { Timeline, type TimelineEntry } from "@/components/ui/timeline";

const defaultEntries: TimelineEntry[] = [
  {
    label: "01 · headers",
    title: "Header contract",
    description:
      "orion-fingerprint, orion-user-agent, and orion-api-system-version must all be present, and Origin must match the client allowlist.",
  },
  {
    label: "02 · credential",
    title: "Credential verified",
    description:
      "Password, passkey assertion, or OAuth callback. Every bad-credential case returns one indistinguishable failure code.",
  },
  {
    label: "03 · device",
    title: "Device recognition",
    description:
      "An unrecognized device triggers the device-authorization flow before any session is issued.",
  },
  {
    label: "04 · issue",
    title: "Token pair minted",
    description:
      "A linked access and refresh token, bound according to the configured security tier, written as HttpOnly cookies.",
  },
];

type ProtocolTimelineProps = {
  entries?: TimelineEntry[];
};

/** `<ProtocolTimeline />` — themed `Timeline` usage for protocol/handshake walkthroughs. */
export function ProtocolTimeline({ entries = defaultEntries }: ProtocolTimelineProps) {
  return <Timeline entries={entries} className="not-prose my-8" />;
}
