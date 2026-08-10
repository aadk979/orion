/**
 * The edition registry.
 *
 * Orion ships as named editions rather than bare semver, and the docs are
 * versioned alongside them: every documentation route lives under
 * `/versions/<slug>/docs`. This file is the only place that fact is written
 * down — `siteConfig.docsBasePath`, the Nextra `contentDirBasePath`, the
 * timeline at `/versions`, and each edition's poster all derive from here.
 *
 * Adding an edition is three steps: add an entry below, snapshot the content
 * directory it documents, and point a route at it. The first two are the work;
 * the third is a folder.
 */

// Relative, not `@/lib/...`: `next.config.ts` imports this module to derive the
// docs base path, and the config is loaded before the `@` alias is resolvable.
// Every import reachable from here has to stay alias-free for the same reason.
import { pendingCopy } from "./release-status";

export type VersionStatus =
  /**
   * On file, documented, and not out yet. Its documentation is readable — that
   * is the point of publishing docs early — but the edition itself has no
   * publication date, no public source, and nothing on this site may imply it
   * has either. See `lib/release-status.ts`.
   */
  | "pending"
  /** Shipping. Exactly one edition holds this, and it owns `content/`. */
  | "current"
  /** Superseded but still published — its docs stay reachable, frozen. */
  | "archived";

/** Human-readable release state, kept beside the registry that owns it. */
export function versionStatusLabel(status: VersionStatus): string {
  switch (status) {
    case "pending":
      return pendingCopy.status;
    case "current":
      return "Current";
    case "archived":
      return "Archived";
  }
}

export type VersionHighlight = {
  /** Where the change landed — a migration, a package, a subsystem. */
  label: string;
  title: string;
  description: string;
};

export type OrionVersion = {
  slug: string;
  /** Display name. The edition's identity — used everywhere over the slug. */
  name: string;
  /** Position in the sequence, one-based. Rendered as `001`. */
  ordinal: number;
  status: VersionStatus;
  /** ISO date the first commit of this edition landed. */
  branchedOn: string;
  /**
   * ISO date the edition was published, or `null` while it is still pending.
   *
   * Nullable rather than absent, and nullable rather than an optimistic
   * placeholder: every surface that wants to print a date has to decide what it
   * shows when there isn't one, and the type is what forces that decision at
   * the call site instead of letting an "Invalid Date" reach a reader.
   */
  publishedOn: string | null;
  /** One line, poster-sized. */
  tagline: string;
  /** A paragraph — what this edition *is*, for the poster's lede. */
  summary: string;
  /** Package versions this edition pins. Mirrors the roadmap's status table. */
  packages: { name: string; version: string; note?: string }[];
  /** Figures for the poster's stat row. */
  stats: { label: string; value: string; hint: string }[];
  /** What the edition brought. Drives the poster's marquee. */
  highlights: VersionHighlight[];
  /** Whether this edition has documentation published under its route. */
  hasDocs: boolean;
};

export const versions: OrionVersion[] = [
  {
    slug: "alpine",
    name: "Alpine",
    ordinal: 1,
    // Alpine is written, documented and in its final phases — but not out. It
    // becomes `"current"` with a real `publishedOn` on the day it ships, and
    // the pending treatment across the site turns itself off. Nothing else
    // about this entry changes.
    status: "pending",
    branchedOn: "2025-04-15",
    publishedOn: null,
    tagline: "The first edition. Authentication you run yourself.",
    summary:
      "Alpine is where Orion became a system rather than a library — an Express application your service embeds, a control plane that supervises the fleet it belongs to, and a policy-governed admin plane over the top. It is the edition that decided what Orion refuses to do: no hosted service, no key escrow, no dependency you did not provision yourself.",
    packages: [
      { name: "Orion-core", version: "1.0.6", note: "@aadharsh/orion-alpine-x934x" },
      { name: "Orion-Orchestrator", version: "1.1.0", note: "orch" },
      { name: "R_Sync", version: "1.0.0", note: "transport" },
      { name: "Client SDK", version: "1.0.6", note: "@aadharsh/orion-client" },
      { name: "Cluster protocol", version: "v2", note: "additive from v1" },
      { name: "Audit schema", version: "2.1.0" },
    ],
    stats: [
      { label: "Auth endpoints", value: "35", hint: "registered on boot" },
      { label: "Security tiers", value: "1–4", hint: "configurable token binding" },
      { label: "Hard dependencies", value: "1", hint: "Postgres, and nothing else" },
      { label: "Migrations", value: "0005", hint: "versioned and checksummed" },
    ],
    highlights: [
      {
        label: "migration 0005",
        title: "Proof of possession",
        description:
          "DPoP thumbprint binding on tokens, WebAuthn challenges moved server-side and made genuinely single-use, and per-account exponential backoff that escalates to step-up rather than locking an account out.",
      },
      {
        label: "migration 0004",
        title: "The security remediation",
        description:
          "A sessions_valid_from watermark, OAuth identity keyed on the provider subject rather than the email, attempt ceilings on every challenge record, and refresh-token reuse detection that revokes the whole family.",
      },
      {
        label: "orch 1.1.0",
        title: "A PBAC admin plane",
        description:
          "Panel, JSON API, and orionctl all behind policy — magic link plus mandatory TOTP, deny-overrides evaluation, and a hash-chained audit table the database itself refuses to let you edit.",
      },
      {
        label: "control plane",
        title: "Fleet signing-key operations",
        description:
          "secrets:list-kids, secrets:revoke-kids, and secrets:force-rotate — fleet-wide key inventory and immediate revocation, without a rolling restart.",
      },
      {
        label: "schema",
        title: "Migrations that fit a fleet",
        description:
          "Versioned, checksummed, advisory-locked schema changes. Boot every node in the cluster at once and exactly one of them applies them.",
      },
      {
        label: "decommissioned",
        title: "DIP and hybrid transport encryption",
        description:
          "The Data Integrity Protocol and the custom transport-encryption layer were removed in favour of TLS 1.3. Payloads travel as plain JSON, and the orion-dip-* and orion-encryption-* headers no longer exist.",
      },
    ],
    hasDocs: true,
  },
];

/**
 * Directions the repository is visibly heading, drawn from the roadmap. These
 * are branch stubs on the timeline, not editions — nothing here has a version,
 * a date, or a promise attached to it.
 */
export const unwrittenBranches: {
  title: string;
  /** Two or three words. What fits beside a branch stub on the timeline. */
  short: string;
  note: string;
}[] = [
  {
    title: "Finish the DPoP rollout path",
    short: "DPoP rollout",
    note: "Republish the SDK bundle with proof generation wired through, so token binding is a config change rather than a source change.",
  },
  {
    title: "Distributed abuse state",
    short: "Fleet-wide abuse state",
    note: "Abuse counters on the shared ephemeral store, making thresholds fleet-wide rather than per-node.",
  },
  {
    title: "Broader secrets-manager domains",
    short: "More secret domains",
    note: "The registry already takes arbitrary kind/domain pairs; only four of them are created at boot.",
  },
];

export const VERSIONS_BASE_PATH = "/versions";

export function versionRoute(version: Pick<OrionVersion, "slug">): string {
  return `${VERSIONS_BASE_PATH}/${version.slug}`;
}

export function versionDocsRoute(version: Pick<OrionVersion, "slug">): string {
  return `${versionRoute(version)}/docs`;
}

export function getVersion(slug: string): OrionVersion | undefined {
  return versions.find((version) => version.slug === slug);
}

/** An edition that is on file but not out. See `lib/release-status.ts`. */
export function isPending(version: OrionVersion): boolean {
  return version.status === "pending";
}

/** An edition with a publication date behind it. */
export function isPublished(version: OrionVersion): boolean {
  return version.publishedOn !== null;
}

/** True while no edition has shipped — the state the whole site is in today. */
export const anyPublished: boolean = versions.some(isPublished);

/**
 * The edition `content/` documents. Everything that resolves a docs URL without
 * being handed an edition — the navbar, the footer, the marketing pages — goes
 * through this.
 *
 * A pending edition counts. Documentation is published ahead of the software it
 * documents, which is the only reason this site exists before launch; falling
 * through to "no edition" here would take every docs route down with it.
 */
export const currentVersion: OrionVersion =
  versions.find((version) => version.status === "current") ??
  versions.find(isPending) ??
  versions[0];

/**
 * Newest first. The timeline reverses this itself; it wants the origin at the
 * bottom of the thread, which is the opposite of how a list wants to read.
 */
export const versionsNewestFirst: OrionVersion[] = [...versions].sort(
  (a, b) => b.ordinal - a.ordinal,
);

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Formats an ISO date for display. Pinned to UTC — without it a date-only
 * string parses as midnight UTC and then renders as the *previous* day for
 * anyone west of Greenwich, so the server and the client disagree and React
 * throws a hydration mismatch.
 */
export function formatVersionDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/**
 * An edition's publication date as it should be read aloud — the date once
 * there is one, and the pending label until then.
 *
 * Every surface that prints a publication date goes through this rather than
 * formatting `publishedOn` itself, so "pending" is worded identically in the
 * poster, the timeline, the ladder and the card, and so a null date can never
 * reach `Intl` and come back as "Invalid Date".
 */
export function publicationLabel(version: OrionVersion): string {
  return version.publishedOn ? formatVersionDate(version.publishedOn) : pendingCopy.date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Days from the edition's first commit to its publication, or `null` while it
 * has not been published — an edition still in progress has no span, and an
 * open-ended one measured against today would be a number that changes every
 * time the site is rebuilt.
 *
 * Both ends are fixed dates from the registry, never `Date.now()`: a figure
 * that moves between the server render and the client render is a hydration
 * mismatch, and one that moves between builds is a diff nobody asked for.
 */
export function developmentDays(version: OrionVersion): number | null {
  if (!version.publishedOn) return null;

  const from = new Date(version.branchedOn).getTime();
  const to = new Date(version.publishedOn).getTime();
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}
