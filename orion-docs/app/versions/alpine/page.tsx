import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, GitBranch } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Grid } from "@/components/ui/grid";
import { MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/animations/fade-in";
import { VersionPoster } from "@/components/versions/version-poster";
import { PendingPoster } from "@/components/versions/pending-poster";
import { VersionHighlights } from "@/components/versions/version-highlights";
import { SealedDocket, type DocketEntry } from "@/components/versions/sealed-docket";
import { pendingCopy } from "@/lib/release-status";
import {
  VERSIONS_BASE_PATH,
  getVersion,
  isPending,
  versionDocsRoute,
  versionRoute,
} from "@/lib/versions";
import { pageMetadata } from "@/lib/seo";

/**
 * Alpine's edition page.
 *
 * A literal route rather than `/versions/[slug]`, because `alpine/docs` is
 * already a literal folder underneath — a static segment and a dynamic sibling
 * at the same level would leave this exact path matching the static branch and
 * finding no page. Editions get a folder each; the poster itself is shared.
 *
 * ## Two pages behind one URL
 *
 * While the edition is pending, this route is a coming-soon plate and nothing
 * else: no stats, no change list, no package manifest — the things that would
 * tell a reader what Alpine contains are exactly the things being withheld
 * until it is issued. What survives is the docket, which shows the reader the
 * *shape* of what is sealed, and the way into the documentation, which is open.
 *
 * The moment `lib/versions.ts` gives Alpine a `publishedOn` and a `"current"`
 * status, the full edition page below takes over — poster, figures, highlights,
 * pinned versions. Both halves are written and maintained; the branch is a
 * single `isPending()` call, and launch is a data change rather than a rewrite.
 * That is the whole reason the withheld content is kept here rather than
 * deleted: content that has to be re-authored to launch never gets launched.
 */
const version = getVersion("alpine");

const pending = version ? isPending(version) : false;

export const metadata: Metadata = pageMetadata({
  title: version ? `${version.name} — Edition 001` : "Edition",
  // A pending edition gets a description that matches what the page actually
  // shows. Shipping the full summary here would put the withheld pitch straight
  // into every search result and social card, which withholds nothing at all.
  description:
    version && pending
      ? `Orion Edition 001 — ${version.name} — is on file and not yet issued. The documentation is open to read now; everything else is sealed until release.`
      : version?.summary,
  path: version ? versionRoute(version) : VERSIONS_BASE_PATH,
});

/**
 * What is being held back, stated as the shape of the thing rather than the
 * thing. Every row is either genuinely withheld or genuinely does not exist
 * yet, and the last one is the exception the other five exist to frame.
 */
const docket: DocketEntry[] = [
  {
    term: "Package manifest",
    note: "The packages this edition pins, and the versions to deploy against. Published with the edition.",
    state: "sealed",
  },
  {
    term: "Change record",
    note: "What the edition brought, subsystem by subsystem, in the order it landed.",
    state: "sealed",
  },
  {
    term: "Issue date",
    note: "Alpine is in its final phases. No date is announced, and an estimate would be a promise.",
    state: "awaiting",
  },
  {
    term: "Public source",
    note: `The repository is not public yet. ${pendingCopy.source}.`,
    state: "awaiting",
  },
  {
    term: "Security disclosure",
    note: "Reporting channels open with the source. Until then the process is documented but not staffed.",
    state: "awaiting",
  },
  {
    term: "Documentation",
    note: "Complete and readable now — architecture, configuration, the API surface and the security model.",
    state: "open",
    href: version ? versionDocsRoute(version) : VERSIONS_BASE_PATH,
    action: "Open it",
  },
];

export default function AlpinePage() {
  if (!version) notFound();

  if (pending) {
    return (
      <>
        {/* Scalars, not the record. `PendingPoster` is a client component, so
            whatever it is handed is serialised into this page's HTML — passing
            `version` would publish the sealed manifest in the payload of the
            page that exists to seal it. See `pending-poster.tsx`. */}
        <PendingPoster
          ordinal={version.ordinal}
          name={version.name}
          docsHref={version.hasDocs ? versionDocsRoute(version) : null}
        />

        <Section size="sm">
          <SectionHeading
            eyebrow="On file"
            title="What is sealed, and what is not."
            description="The edition is written and documented; it has not been issued. Rather than quietly omit what is being held back, here it is — labelled, struck, and honest about which of it is withheld and which of it simply does not exist yet."
          />
          <SealedDocket entries={docket} />
        </Section>

        <Section size="md" className="text-center">
          <FadeIn>
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance text-text-primary md:text-4xl">
              The documentation did not wait.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-text-secondary">
              Getting started, the architecture, every configuration key and the security model —
              all of it readable now, ahead of the edition it describes.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href={versionDocsRoute(version)} size="lg">
                Open the documentation
                <ArrowRight className="size-4" />
              </Button>
              <Button href={VERSIONS_BASE_PATH} variant="secondary" size="lg">
                <GitBranch className="size-4" />
                Back to the timeline
              </Button>
            </div>
          </FadeIn>
        </Section>
      </>
    );
  }

  return (
    <>
      <VersionPoster version={version} />

      <Section size="sm">
        <FadeIn>
          <p className="max-w-3xl text-lg leading-relaxed text-text-secondary">
            {version.summary}
          </p>
        </FadeIn>

        <Grid columns={4} className="mt-12">
          {version.stats.map((stat) => (
            <MetricCard key={stat.label} {...stat} />
          ))}
        </Grid>
      </Section>

      <Section id="what-changed" size="sm" className="scroll-mt-(--height-nav)">
        <SectionHeading
          eyebrow={`Edition ${String(version.ordinal).padStart(3, "0")}`}
          title={`What ${version.name} brought.`}
          description="The headline changes, in the order they landed. The reliable record of everything else is the migration directory — each file opens with the issue it addresses and the reasoning behind the fix."
        />
        <VersionHighlights highlights={version.highlights} />
      </Section>

      <Section size="sm">
        <SectionHeading
          eyebrow="Pinned"
          title="What this edition ships."
          description="The versions Alpine documents. Pin these — the surface described in its documentation is what these versions do, and nothing is frozen until an edition is archived."
        />
        <FadeIn>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-faint bg-white/[0.02]">
                  <th className="px-5 py-3 font-medium text-text-tertiary">Package</th>
                  <th className="px-5 py-3 font-medium text-text-tertiary">Version</th>
                  <th className="px-5 py-3 font-medium text-text-tertiary">Notes</th>
                </tr>
              </thead>
              <tbody>
                {version.packages.map((pkg) => (
                  <tr key={pkg.name} className="border-b border-border-faint last:border-b-0">
                    <td className="px-5 py-3 font-medium text-text-primary">{pkg.name}</td>
                    <td className="px-5 py-3 font-mono tabular-nums text-accent-bright">
                      {pkg.version}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-text-tertiary">
                      {pkg.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>
      </Section>

      <Section size="md" className="text-center">
        <FadeIn>
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance text-text-primary md:text-4xl">
            Everything above, written down properly.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg text-text-secondary">
            {version.name}&rsquo;s documentation — getting started, the architecture, every
            configuration key, and the security model.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href={versionDocsRoute(version)} size="lg">
              Open the documentation
              <ArrowRight className="size-4" />
            </Button>
            <Button href={VERSIONS_BASE_PATH} variant="secondary" size="lg">
              <GitBranch className="size-4" />
              Back to the timeline
            </Button>
          </div>
        </FadeIn>
      </Section>
    </>
  );
}
